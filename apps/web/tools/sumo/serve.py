#!/usr/bin/env python3
"""Local SUMO job API. Native engine execution; no frontend files are written."""
import argparse
import functools
import json
import math
import re
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import parse_qs, urlsplit

import build_demo as model

PREFIX = '/sumo/v1'
MAX_BODY = 16384
RUN_ID = r'[0-9a-f]{32}'


class ApiError(Exception):
    def __init__(self, status, message):
        self.status, self.message = status, message


def now():
    return datetime.now(timezone.utc).isoformat()


@functools.lru_cache(maxsize=8)
def read_json(path):
    return json.loads(path.read_text(encoding='utf-8'))


def frame_at(output, scenario, time):
    if scenario not in model.SCENARIOS or not math.isfinite(time) or time < 0:
        raise ApiError(400, 'Unknown scenario or invalid nonnegative time')
    path = output / scenario / 'manifest.json'
    if not path.exists(): raise ApiError(404, 'Scenario was not included in this run')
    meta = read_json(path)
    frame = {'t': time, 'a': [], 'q': [], 'signals': {}, 'counts': {}}
    if time < meta['duration_s'] and meta['chunks']:
        chunk = next((c for c in reversed(meta['chunks']) if c['start'] <= time), meta['chunks'][0])
        frames = read_json(output / scenario / chunk['file'])['frames']
        frame = next((f for f in reversed(frames) if f['t'] <= time), frames[0])
    agents = []
    for row in frame['a']:
        item = meta['agents'][row[0]]
        agents.append({'id': item['id'], 'kind': item['kind'], 'length_m': item['length'], 'width_m': item['width'],
                       'x_m': row[1] / 100, 'y_m': row[2] / 100, 'angle_deg': row[3], 'speed_mps': row[4] / 100,
                       'lane_id': meta['geometry']['lanes'][row[5]]['id'] if row[5] >= 0 else None})
    return {'version': 1, 'scenario': scenario, 'requested_time_s': time, 'time_s': frame['t'],
            'done': time >= meta['duration_s'], 'position_reference': 'center', 'agents': agents,
            'signals': frame['signals'], 'counts': frame['counts'],
            'queues': [{'lane_id': meta['geometry']['lanes'][i]['id'], 'length_m': length} for i, length in frame['q']]}


class Jobs:
    def __init__(self, root, engine, runner=None, limit=4):
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.engine, self.runner, self.limit = engine, runner or model.build, limit
        self.lock = threading.RLock()
        self.pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix='sumo')
        self.active = 0
        # Interrupted jobs never pretend to still be progressing after a restart.
        for file in self.root.glob('*/job.json'):
            value = json.loads(file.read_text())
            if value.get('status') in ('queued', 'running'):
                self.update(value, status='failed', error='Service restarted before the run finished')

    def update(self, job, **fields):
        with self.lock:
            job.update(fields, updated_at=now())
            folder = self.root / job['id']; folder.mkdir(exist_ok=True)
            temp = folder / 'job.tmp'
            model.dump(temp, job)
            temp.replace(folder / 'job.json')

    def get(self, run_id):
        if not re.fullmatch(RUN_ID, run_id): raise ApiError(404, 'Run not found')
        file = self.root / run_id / 'job.json'
        with self.lock:
            if not file.exists(): raise ApiError(404, 'Run not found')
            return json.loads(file.read_text())

    def create(self, payload):
        try: config = model.validate_config(payload)
        except ValueError as e: raise ApiError(400, str(e)) from e
        with self.lock:
            if self.active >= self.limit: raise ApiError(429, 'Queue full; retry when an active run completes')
            self.active += 1
            job = {'version': 1, 'id': uuid.uuid4().hex, 'status': 'queued', 'created_at': now(), 'config': config}
            self.update(job)
            snapshot = dict(job)
            self.pool.submit(self.execute, job)
        return snapshot

    def execute(self, job):
        root = self.root / job['id']
        try:
            self.update(job, status='running')
            args = SimpleNamespace(**job['config'], output=root / 'output', work_dir=root / 'raw')
            self.runner(args)
            if not (root / 'output/index.json').exists(): raise RuntimeError('No complete result index was produced')
            self.update(job, status='complete', result=f"{PREFIX}/runs/{job['id']}/index.json")
        except Exception as e:
            # Full diagnostics remain in the local raw folder, never mistaken for a successful run.
            self.update(job, status='failed', error=str(e)[-3000:])
        finally:
            with self.lock: self.active -= 1

    def output(self, run_id):
        job = self.get(run_id)
        if job['status'] != 'complete': raise ApiError(409, 'Run is not complete; query its status first')
        return self.root / run_id / 'output'

    def route(self, method, target, payload=None):
        parsed = urlsplit(target)
        path = parsed.path
        if method == 'GET' and path == PREFIX + '/health':
            return 200, {'version': 1, 'engine': self.engine, 'status': 'ready', 'active_jobs': self.active}
        if path == PREFIX + '/runs' and method == 'POST': return 202, self.create(payload)
        match = re.fullmatch(PREFIX + '/runs/(' + RUN_ID + r')(?:/(.*))?', path)
        if method != 'GET' or not match: raise ApiError(404, 'Endpoint not found')
        run_id, resource = match.groups()
        if not resource: return 200, self.get(run_id)
        output = self.output(run_id)
        if resource == 'frame':
            query = parse_qs(parsed.query)
            if set(query) != {'scenario', 't'} or any(len(v) != 1 for v in query.values()):
                raise ApiError(400, 'Use exactly scenario and t query parameters')
            try: time = float(query['t'][0])
            except ValueError as e: raise ApiError(400, 't must be a nonnegative number') from e
            return 200, frame_at(output, query['scenario'][0], time)
        if not re.fullmatch(r'(index\.json|(?:baseline|closure|guided|footpath)/(?:manifest|frames-\d{3})\.json)', resource):
            raise ApiError(404, 'Output file not found')
        file = output / resource
        if not file.exists(): raise ApiError(404, 'Output file not found')
        return 200, read_json(file)

    def close(self):
        self.pool.shutdown(wait=True)


class Handler(BaseHTTPRequestHandler):
    def reply(self, status, value):
        data = (json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(',', ':'))+'\n').encode()
        self.send_response(status)
        origin = self.headers.get('Origin')
        if origin and origin in self.server.origins:
            self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Vary', 'Origin')
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        if self.command == 'OPTIONS':
            self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
            self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
        self.wfile.write(data)

    def handle_request(self):
        try:
            origin = self.headers.get('Origin')
            if origin and origin not in self.server.origins: raise ApiError(403, 'Origin not allowed')
            if self.command == 'OPTIONS': return self.reply(200, {'ok': True})
            payload = None
            if self.command == 'POST':
                if self.headers.get_content_type() != 'application/json': raise ApiError(415, 'Use application/json')
                try: size = int(self.headers.get('Content-Length', '0'))
                except ValueError as e: raise ApiError(400, 'Invalid Content-Length') from e
                if size <= 0 or size > MAX_BODY: raise ApiError(413, 'JSON body must be between 1 and 16384 bytes')
                try: payload = json.loads(self.rfile.read(size))
                except (ValueError, UnicodeError) as e: raise ApiError(400, 'Invalid JSON body') from e
            status, value = self.server.jobs.route(self.command, self.path, payload)
            self.reply(status, value)
        except ApiError as e:
            self.reply(e.status, {'error': e.message})

    do_GET = do_POST = do_OPTIONS = handle_request


def make_server(port, jobs, origins=()):
    server = ThreadingHTTPServer(('127.0.0.1', port), Handler)
    server.jobs, server.origins = jobs, set(origins)
    return server


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8021)
    parser.add_argument('--data-dir', type=Path, required=True)
    parser.add_argument('--allow-origin', action='append', default=[])
    args = parser.parse_args()
    _, engine = model.binaries()
    jobs = Jobs(args.data_dir, engine)
    server = make_server(args.port, jobs, args.allow_origin)
    print(f'SUMO API ready: http://127.0.0.1:{server.server_port}{PREFIX}/health', flush=True)
    try: server.serve_forever()
    except KeyboardInterrupt: pass
    finally:
        server.server_close()
        jobs.close()
