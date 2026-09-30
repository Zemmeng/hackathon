#!/usr/bin/env python3
"""Exercise the real local HTTP API and verify every native replay chunk."""
import argparse
import hashlib
import json
import time
import urllib.request


def verify(base, run_id=None):
    def get(path):
        with urllib.request.urlopen(base+path,timeout=30) as response:return response.read()
    assert '1.27.1' in json.loads(get('/health'))['engine']
    if run_id is None:
        request=urllib.request.Request(base+'/runs',data=b'{}',headers={'Content-Type':'application/json'},method='POST')
        with urllib.request.urlopen(request,timeout=30) as response:
            assert response.status==202
            job=json.load(response);run_id=job['id']
    start=time.monotonic();previous=None
    while True:
        job=json.loads(get('/runs/'+run_id))
        if job['status']!=previous:print('Native SUMO job:',job['status'],flush=True);previous=job['status']
        if job['status']=='failed':raise AssertionError(job['error'])
        if job['status']=='complete':break
        if time.monotonic()-start>180:raise TimeoutError('Native SUMO job did not finish within 180 seconds')
        time.sleep(1)
    result=json.loads(get('/runs/'+run_id+'/index.json'))
    checks=0
    for scenario in result['scenarios']:
        prefix='/runs/'+run_id+'/'+scenario['id']+'/'
        m=json.loads(get(prefix+'manifest.json'))
        assert m['demand_hash']==result['demand_hash']
        assert {j['id'] for j in m['geometry']['junctions']}==set('ABCD')
        assert m['validation']=={'collisions':0,'teleports':0,'emergency_braking':0,'emergency_stops':0,'forced_pedestrian_escape':0,'all_arrived':True}
        assert m['metrics']['vehicles_unfinished']==m['metrics']['pedestrians_unfinished']==0
        checks+=4;seen=set();last=-1;peak=0
        closed={i for i,l in enumerate(m['geometry']['lanes']) if l['closed']}
        for chunk in m['chunks']:
            raw=get(prefix+chunk['file'])
            assert hashlib.sha256(raw).hexdigest()==chunk['sha256']
            frames=json.loads(raw)['frames'];assert len(frames)==chunk['frames']
            for f in frames:
                assert f['t']>last;last=f['t']
                assert set(f['signals'])==set('ABCD')
                assert len({a[0] for a in f['a']})==len(f['a'])
                peak=max(peak,max((q[1] for q in f['q']),default=0))
                for a in f['a']:
                    assert 0<=a[0]<len(m['agents']) and a[5] not in closed and a[4]>=0
                    seen.add(a[0])
            checks+=1
        assert len(seen)==len(m['agents'])
        assert abs(peak-m['metrics']['max_lane_queue_m'])<.11
        frame=json.loads(get('/runs/'+run_id+'/frame?scenario='+scenario['id']+'&t=118.9'))
        assert frame['time_s']==118
        assert frame['position_reference']=='center'
        final=json.loads(get('/runs/'+run_id+'/frame?scenario='+scenario['id']+'&t=4000'))
        assert final['done'] and not final['agents']
        checks+=4
        print(scenario['id'],json.dumps({k:m['metrics'][k] for k in ['vehicles_completed','pedestrians_completed','collisions','mean_journey_s','max_lane_queue_m']}),flush=True)
    print(f'{checks} native API/data checks passed; run {run_id}',flush=True)
    return run_id


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base',default='http://127.0.0.1:8021/sumo/v1')
    parser.add_argument('--run-id')
    args=parser.parse_args()
    verify(args.base,args.run_id)
