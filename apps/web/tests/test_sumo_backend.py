"""SUMO backend unit/API contract tests; native executable is not required in CI."""
import io
import json
import pathlib
import sys
import tempfile
import threading
import unittest
from types import SimpleNamespace

TOOLS=pathlib.Path(__file__).resolve().parents[1]/'tools/sumo'
sys.path.insert(0,str(TOOLS))
import build_demo as model
import serve


def fixture(args):
    out=pathlib.Path(args.output)
    model.dump(out/'index.json',{'version':1,'config':{k:getattr(args,k) for k in model.DEFAULT_CONFIG}})
    model.dump(out/'baseline/manifest.json',{
        'duration_s':3,'agents':[{'id':'bus-1','kind':'bus','length':12,'width':2.5}],
        'geometry':{'lanes':[{'id':'A_B_1'}]},
        'chunks':[{'file':'frames-000.json','start':0,'end':2}]})
    model.dump(out/'baseline/frames-000.json',{'frames':[
        {'t':t,'a':[[0,12345,-240,90,500,0]],'q':[[0,25]],'signals':{'A':'Gr'},'counts':{'running':1}}
        for t in range(3)]})


class BackendTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.jobs=serve.Jobs(self.temp.name,'SUMO test fixture',runner=fixture)

    def tearDown(self):
        self.jobs.close();serve.read_json.cache_clear();self.temp.cleanup()

    def complete(self):
        job=self.jobs.create({})
        self.jobs.close()
        return self.jobs.get(job['id'])

    def test_demand_reproducible(self):
        self.assertEqual(model.demand(42),model.demand(42))
        self.assertNotEqual(model.demand(42),model.demand(43))
        self.assertEqual(len(model.demand(42)),759)

    def test_scale_and_duration_change_demand(self):
        self.assertLess(len(model.demand(42,60)),len(model.demand(42,600)))
        self.assertLess(len(model.demand(42,600,.5)),len(model.demand(42,600,1)))

    def test_four_junctions_are_connected(self):
        seen={'A'}
        for _ in range(len(model.NODES)):
            for a,b in model.PAIRS:
                if a in seen or b in seen:seen.update([a,b])
        self.assertEqual(set(model.NODES),seen)
        self.assertEqual(model.JUNCTIONS,list('ABCD'))

    def test_safety_validation_reads_engine_counters(self):
        root=pathlib.Path(self.temp.name)
        (root/'statistics.xml').write_text('<statistics><safety collisions="2" emergencyStops="1" emergencyBraking="3"/><teleports total="4"/></statistics>')
        checked=model.validation(root,{'collisions':1,'vehicles_unfinished':0,'pedestrians_unfinished':2},'Warning: person is jammed')
        self.assertEqual(checked,{'collisions':2,'teleports':4,'emergency_braking':3,'emergency_stops':1,'forced_pedestrian_escape':1,'all_arrived':False})

    def test_missing_safety_output_is_not_reported_as_zero(self):
        root=pathlib.Path(self.temp.name)
        (root/'statistics.xml').write_text('<statistics/>')
        with self.assertRaises(RuntimeError):model.validation(root,{},'')

    def test_config_rejects_unsupported_and_nonfinite_values(self):
        for config in [{'weather':'rain'},{'seed':True},{'seed':-1},{'seed':1.5},{'demand_scale':float('nan')},
                       {'diversion_share':float('inf')},{'demand_duration_s':601},{'scenarios':['no-such-scenario']},
                       {'scenarios':[]},{'scenarios':['closure','closure']},{'scenarios':'closure'},None,[]]:
            with self.subTest(config=config),self.assertRaises(ValueError):model.validate_config(config)

    def test_comparison_always_includes_baseline(self):
        c=model.validate_config({'scenarios':['guided']})
        self.assertEqual(c['scenarios'],['baseline','guided'])

    def test_create_status_and_completion(self):
        job=self.complete()
        self.assertEqual(job['status'],'complete')
        status,data=self.jobs.route('GET',job['result'])
        self.assertEqual(status,200);self.assertEqual(data['version'],1)
        self.assertEqual(data['config'],job['config'])

    def test_pending_job_cannot_publish_partial_results(self):
        event=threading.Event()
        self.jobs.runner=lambda args:event.wait(5)
        job=self.jobs.create({})
        try:
            with self.assertRaises(serve.ApiError) as e:self.jobs.output(job['id'])
            self.assertEqual(e.exception.status,409)
        finally:event.set()

    def test_failed_job_exposes_no_result(self):
        def broken(args):raise RuntimeError('test simulation failed')
        self.jobs.runner=broken
        job=self.complete()
        self.assertEqual(job['status'],'failed');self.assertNotIn('result',job)
        self.assertIn('test simulation failed',job['error'])

    def test_queue_is_bounded(self):
        event=threading.Event();self.jobs.limit=1
        self.jobs.runner=lambda args:event.wait(5)
        self.jobs.create({})
        try:
            with self.assertRaises(serve.ApiError) as e:self.jobs.create({})
            self.assertEqual(e.exception.status,429)
        finally:event.set()

    def test_frame_decodes_si_units_and_uses_actual_sample(self):
        job=self.complete();path=f"{serve.PREFIX}/runs/{job['id']}/frame?scenario=baseline&t=1.9"
        status,frame=self.jobs.route('GET',path)
        self.assertEqual(status,200);self.assertEqual(frame['time_s'],1)
        self.assertEqual(frame['requested_time_s'],1.9);self.assertFalse(frame['done'])
        agent=frame['agents'][0]
        self.assertEqual((agent['x_m'],agent['y_m'],agent['speed_mps']),(123.45,-2.4,5))
        self.assertEqual(agent['length_m'],12);self.assertEqual(agent['lane_id'],'A_B_1')
        self.assertEqual(frame['signals'],{'A':'Gr'})
        self.assertEqual(frame['queues'],[{'lane_id':'A_B_1','length_m':25}])

    def test_no_ghost_agents_after_completion(self):
        job=self.complete()
        frame=serve.frame_at(self.jobs.output(job['id']),'baseline',3)
        self.assertTrue(frame['done']);self.assertEqual(frame['agents'],[])

    def test_frame_rejects_bad_time_and_absent_scenario(self):
        job=self.complete();root=self.jobs.output(job['id'])
        for t in [-1,float('nan'),float('inf')]:
            with self.assertRaises(serve.ApiError):serve.frame_at(root,'baseline',t)
        with self.assertRaises(serve.ApiError) as e:serve.frame_at(root,'guided',0)
        self.assertEqual(e.exception.status,404)

    def test_path_traversal_cannot_read_raw_files(self):
        job=self.complete()
        for path in ['../raw/stdout.log','%2e%2e/job.json','baseline/../../job.json','job.json']:
            with self.assertRaises(serve.ApiError):self.jobs.route('GET',f"{serve.PREFIX}/runs/{job['id']}/{path}")

    def test_restart_marks_interrupted_job_failed(self):
        self.jobs.update({'id':'a'*32,'status':'running'})
        second=serve.Jobs(self.temp.name,'fixture',runner=fixture)
        try:self.assertEqual(second.get('a'*32)['status'],'failed')
        finally:second.close()

    def http(self,request):
        class Socket:
            def __init__(self):self.output=bytearray()
            def makefile(self,*args):return io.BytesIO(request)
            def sendall(self,value):self.output.extend(value)
        class QuietHandler(serve.Handler):
            def log_message(self,*args):pass
        sock=Socket();QuietHandler(sock,('127.0.0.1',12345),SimpleNamespace(jobs=self.jobs,origins={'http://127.0.0.1:8001'}))
        return bytes(sock.output)

    def test_unapproved_origin_rejected_without_cors_grant(self):
        raw=self.http(b'POST /sumo/v1/runs HTTP/1.0\r\nOrigin: https://untrusted.example\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\n{}')
        self.assertIn(b'403',raw.splitlines()[0]);self.assertNotIn(b'Access-Control-Allow-Origin',raw)
        self.assertEqual(self.jobs.active,0)

    def test_preflight_allows_only_explicit_origin(self):
        raw=self.http(b'OPTIONS /sumo/v1/runs HTTP/1.0\r\nOrigin: http://127.0.0.1:8001\r\n\r\n')
        self.assertIn(b'200',raw.splitlines()[0]);self.assertIn(b'Access-Control-Allow-Origin: http://127.0.0.1:8001',raw)

    def test_oversized_body_and_non_json_rejected(self):
        for header,code in [(b'Content-Type: application/json\r\nContent-Length: 20000',b'413'),
                            (b'Content-Type: text/plain\r\nContent-Length: 2',b'415')]:
            raw=self.http(b'POST /sumo/v1/runs HTTP/1.0\r\n'+header+b'\r\n\r\n{}')
            self.assertIn(code,raw.splitlines()[0])

    def test_invalid_json_rejected(self):
        raw=self.http(b'POST /sumo/v1/runs HTTP/1.0\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\nxx')
        self.assertIn(b'400',raw.splitlines()[0])


if __name__=='__main__':
    result=unittest.TextTestRunner(verbosity=1).run(unittest.defaultTestLoader.loadTestsFromTestCase(BackendTests))
    failed=len(result.errors)+len(result.failures)
    print(f'{result.testsRun-failed} passed, {failed} failed')
    sys.exit(1 if failed else 0)
