#!/usr/bin/env python3
"""Build a reproducible four-junction SUMO study and browser replay.
All input demand is synthetic. Runs native SUMO, never invents trajectories.
Install requirements.txt in a venv; run this script with that venv's Python.
Raw SUMO inputs/outputs stay in --work-dir; only compact replay is published.
"""
import argparse
import collections
import hashlib
import json
import math
import random
import shutil
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
VERSION = '1.27.1'
NODES = {'A': (0, 160), 'B': (200, 160), 'C': (0, 0), 'D': (200, 0),
         'WA': (-140,160), 'EB': (340,160), 'WC': (-140,0), 'ED': (340,0),
         'NA': (0,300), 'NB': (200,300), 'SC': (0,-140), 'SD': (200,-140)}
PAIRS = [('A','B'),('A','C'),('C','D'),('B','D'),('WA','A'),('B','EB'),('WC','C'),('D','ED'),('NA','A'),('NB','B'),('SC','C'),('SD','D')]
JUNCTIONS = ['A','B','C','D']
SCENARIOS = {'baseline': {'label': '无施工', 'closed': False, 'diversion': 0},
             'closure': {'label': '封一条车道', 'closed': True, 'diversion': 0},
             'guided': {'label': '封道 + 提前绕行', 'closed': True, 'diversion': .45},
             'footpath': {'label': '封道 + 人行道封闭', 'closed': True, 'diversion': 0, 'footpath': True}}
DEMAND_END = 600
MAX_END = 1800
STEP = .2
SAMPLE = 1
CHUNK_SECONDS = 60
DIRECT = ['WA_A','A_B','B_EB']
DETOUR = ['WA_A','A_C','C_D','D_B','B_EB']
VEH_CLASSES = {'car': (4.5,1.8), 'bus': (12,2.5)}


def dump(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(',',':'))+'\n', encoding='utf-8')


def xml(path, root):
    ET.indent(root)
    ET.ElementTree(root).write(path, encoding='utf-8', xml_declaration=True)


def command(args, cwd):
    p = subprocess.run([str(x) for x in args], cwd=cwd, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=180)
    if p.returncode:
        raise RuntimeError(p.stdout[-10000:])
    return p.stdout


def binaries():
    exe = Path(sys.executable).parent
    bins = {name: str(exe/name) if (exe/name).exists() else shutil.which(name) for name in ['sumo','netconvert']}
    if not all(bins.values()):
        raise RuntimeError('Install tools/sumo/requirements.txt in a virtual environment first.')
    # Under an unsupported locale SUMO prints "Warning: Could not set locale to 'C'." before the version line.
    out = command([bins['sumo'],'--version'], ROOT)
    version = next((l.strip() for l in out.splitlines() if l.startswith('Eclipse SUMO')), out.strip()[:200])
    if VERSION not in version:
        raise RuntimeError('Expected SUMO '+VERSION+', got '+version)
    return bins, version


def network(folder, bins, footpath=False):
    ns = ET.Element('nodes')
    for n,(x,y) in NODES.items():
        ET.SubElement(ns,'node',id=n,x=str(x),y=str(y),type='traffic_light' if n in JUNCTIONS else 'priority')
    es = ET.Element('edges')
    for a,b in PAIRS:
        for f,t in [(a,b),(b,a)]:
            e=ET.SubElement(es,'edge',id=f+'_'+t,attrib={'from':f,'to':t,'numLanes':'3','speed':'11.11','priority':'2','spreadType':'right'})
            ET.SubElement(e,'lane',index='0',width='2.4',speed='1.4',**({'disallow':'all'} if footpath and f+'_'+t=='A_B' else {'allow':'pedestrian'}))
            for i in [1,2]: ET.SubElement(e,'lane',index=str(i),allow='passenger bus',width='3.2')
    cs=ET.Element('connections')
    for n in JUNCTIONS:
        for a,b in PAIRS:
            if n in [a,b]: ET.SubElement(cs,'crossing',node=n,edges=a+'_'+b+' '+b+'_'+a,width='3')
    xml(folder/'nodes.nod.xml',ns);xml(folder/'edges.edg.xml',es);xml(folder/'crossings.con.xml',cs)
    result=command([bins['netconvert'],'-n','nodes.nod.xml','-e','edges.edg.xml','-x','crossings.con.xml','-o','base.net.xml',
        '--lefthand','true','--no-turnarounds','true','--walkingareas','true','--tls.default-type','static','--tls.green.time','35',
        '--tls.yellow.time','3','--tls.allred.time','2','--junctions.corner-detail','8','--no-warnings','true'],folder)
    return ET.parse(folder/'base.net.xml')


def demand(seed, duration=DEMAND_END, scale=1):
    rng=random.Random(seed)
    rows=[]
    # Shared desired departure times, IDs, types and destinations across scenarios.
    streams=[('main',DIRECT,1150),('reverse',['EB_B','B_A','A_WA'],420),
             ('south',['WC_C','C_D','D_ED'],580),('south_rev',['ED_D','D_C','C_WC'],300),
             ('vertical_w',['NA_A','A_C','C_SC'],320),('vertical_e',['SD_D','D_B','B_NB'],320)]
    for name,path,vph in streams:
        t=rng.random()*3;i=0
        while t<duration:
            rows.append({'id':name+'_'+str(i),'depart':round(t,1),'type':'car','route':path,'stream':name,'u':rng.random()})
            i+=1;t+=rng.expovariate(vph*scale/3600)
    for i in range(math.ceil(duration*scale/60)):
        t=15+i*60/scale
        if t>=duration:break
        rows.append({'id':'bus_'+str(i),'depart':t,'type':'bus','route':DIRECT,'stream':'bus','u':1})
    # Pedestrians travel to the same destinations. SUMO chooses walkable paths.
    for name,start,end,rate in [('north','WA_A','B_EB',720),('opposite','EB_B','A_WA',500),('south_p','WC_C','D_ED',360)]:
        t=rng.random()*3;i=0
        while t<duration:
            rows.append({'id':'ped_'+name+'_'+str(i),'depart':round(t,1),'type':'ped','from':start,'to':end,'u':rng.random()})
            i+=1;t+=rng.expovariate(rate*scale/3600)
    return sorted(rows,key=lambda r:(r['depart'],r['id']))


def prepare(folder, base, rows, scenario, diversion_share=.45):
    spec=SCENARIOS[scenario]
    net=ET.fromstring(ET.tostring(base.getroot()))
    if spec['closed']:
        # Keep identical geometry and TLS; close the inner car lane.
        lane=net.find("./edge[@id='A_B']/lane[@index='2']")
        lane.attrib.pop('allow',None);lane.set('disallow','all')
    xml(folder/'network.net.xml',net)
    routes=ET.Element('routes')
    ET.SubElement(routes,'vType',id='car',vClass='passenger',carFollowModel='Krauss',length='4.5',width='1.8',maxSpeed='11.11',accel='2.6',decel='4.5',emergencyDecel='9',tau='1.2',minGap='2.5',sigma='.5',speedFactor='1')
    ET.SubElement(routes,'vType',id='bus',vClass='bus',length='12',width='2.5',maxSpeed='10',accel='1.2',decel='3',tau='1.5',minGap='3',speedFactor='1')
    ET.SubElement(routes,'vType',id='walker',vClass='pedestrian',width='.5',length='.5',maxSpeed='1.35',speedFactor='1')
    diverted=[]
    for r in rows:
        if r['type']=='ped':
            p=ET.SubElement(routes,'person',id=r['id'],type='walker',depart=str(r['depart']))
            ET.SubElement(p,'walk',attrib={'from':r['from'],'to':r['to'],'arrivalPos':'max'})
        else:
            path=r['route']
            if r['stream']=='main' and r['u']<(diversion_share if scenario=='guided' else 0):
                path=DETOUR;diverted.append(r['id'])
            v=ET.SubElement(routes,'vehicle',id=r['id'],type=r['type'],depart=str(r['depart']),departLane='best',departSpeed='0')
            ET.SubElement(v,'route',edges=' '.join(path))
    xml(folder/'demand.rou.xml',routes)
    add=ET.Element('additional')
    for e in net.findall('edge'):
        if e.get('function'):continue
        for lane in e.findall('lane'):
            if lane.get('index')=='0' or lane.get('disallow')=='all':continue
            ET.SubElement(add,'laneAreaDetector',id=lane.get('id'),lane=lane.get('id'),pos='0',endPos=str(float(lane.get('length'))-.1),period='1',file='queues.xml',timeThreshold='1',speedThreshold='.1',jamThreshold='10')
    # Exact signal states exported by SUMO for replay; do not recreate a second signal clock in JS.
    for junction in JUNCTIONS:
        ET.SubElement(add,'timedEvent',type='SaveTLSStates',source=junction,dest='signals-'+junction+'.xml')
    xml(folder/'additional.add.xml',add)
    return net,diverted


def run(folder,bins,seed,end=MAX_END):
    args=[bins['sumo'],'-n','network.net.xml','-r','demand.rou.xml','-a','additional.add.xml','--seed',str(seed),'--step-length',str(STEP),
          '--end',str(end),'--time-to-teleport','-1','--collision.action','warn','--collision.check-junctions','true',
          '--collision.mingap-factor','0','--collision-output','collisions.xml','--fcd-output','fcd.xml','--device.fcd.period',str(SAMPLE),
          '--fcd-output.attributes','id,x,y,angle,type,speed,lane,edge','--tripinfo-output','trips.xml','--tripinfo-output.write-unfinished','true',
          '--tripinfo-output.write-undeparted','true','--personinfo-output','persons.xml','--summary-output','summary.xml',
          '--statistic-output','statistics.xml','--pedestrian.model','striping','--pedestrian.striping.jamtime','100000',
          '--pedestrian.striping.jamtime.crossing','100000','--pedestrian.striping.jamtime.narrow','100000',
          '--no-step-log','true','--duration-log.disable','true','--log','run.log']
    (folder/'command.json').write_text(json.dumps(args[1:],indent=2)+'\n')
    log=command(args,folder)
    (folder/'stdout.log').write_text(log)
    return log


def shape(text):return [[round(float(v),2) for v in point.split(',')[:2]] for point in text.split()]


def export_geometry(net):
    return {'junctions':[{'id':n.get('id'),'x':float(n.get('x')),'y':float(n.get('y')),'shape':shape(n.get('shape',''))} for n in net.findall('junction') if n.get('id') in JUNCTIONS],
        'lanes':[{'id':l.get('id'),'edge':e.get('id'),'index':int(l.get('index')),'length':float(l.get('length')),'width':float(l.get('width','3.2')),'shape':shape(l.get('shape')),
                  'kind':'crossing' if e.get('function')=='crossing' else 'walkingarea' if e.get('function')=='walkingarea' else 'sidewalk' if l.get('index')=='0' and not e.get('function') else 'road',
                  'closed':l.get('disallow')=='all','internal':e.get('function') is not None} for e in net.findall('edge') for l in e.findall('lane')],
        'signals':[{'junction':c.get('tl'),'index':int(c.get('linkIndex')),'lane':c.get('from')+'_'+c.get('fromLane')} for c in net.findall('connection') if c.get('tl') and c.get('from') and not c.get('from').startswith(':')]}


def metrics(folder,rows,diverted,diversion_share=.45):
    trips=[x.attrib for x in ET.parse(folder/'trips.xml').getroot().findall('tripinfo')]
    persons=[]
    for p in ET.parse(folder/'persons.xml').getroot().findall('personinfo'):
        w=p.find('walk')
        if w is not None:persons.append({'id':p.get('id'),**w.attrib})
    completed=[r for r in trips if float(r['arrival'])>=0]
    pc=[r for r in persons if float(r.get('arrival','-1'))>=0]
    vehicle_rows=[r for r in rows if r['type']!='ped']
    ped_rows=[r for r in rows if r['type']=='ped']
    def avg(xs):return round(sum(xs)/len(xs),2) if xs else None
    # Include delay before insertion. Compare the same complete trip cohort across all scenarios.
    journey={r['id']:float(r['duration'])+float(r['departDelay']) for r in completed}
    pj={r['id']:float(r['duration']) for r in pc}
    return {'vehicles_demand':len(vehicle_rows),'vehicles_completed':len(completed),'vehicles_unfinished':len(vehicle_rows)-len(completed),
        'pedestrians_demand':len(ped_rows),'pedestrians_completed':len(pc),'pedestrians_unfinished':len(ped_rows)-len(pc),
        'mean_journey_s':avg(list(journey.values())), 'mean_ped_journey_s':avg(list(pj.values())),
        'mean_bus_journey_s':avg([journey[r['id']] for r in completed if r['vType']=='bus']),
        'vehicle_time_loss_s':round(sum(float(r['timeLoss'])+float(r['departDelay']) for r in completed),2),
        'ped_wait_s':round(sum(float(r.get('waitingTime','0')) for r in pc),2),
        'diverted_vehicles':len(diverted),'diversion_share':diversion_share if folder.name=='guided' else 0,
        'collisions':len(ET.parse(folder/'collisions.xml').getroot().findall('collision'))},journey,pj


def validation(folder, metrics, log):
    stats=ET.parse(folder/'statistics.xml').getroot()
    safety,teleports=stats.find('safety'),stats.find('teleports')
    if safety is None or teleports is None:raise RuntimeError('SUMO safety diagnostics missing')
    return {'collisions':max(metrics['collisions'],int(safety.get('collisions'))),
            'teleports':int(teleports.get('total')),'emergency_braking':int(safety.get('emergencyBraking')),
            'emergency_stops':int(safety.get('emergencyStops')),
            'forced_pedestrian_escape':sum('is jammed' in line.lower() for line in log.splitlines()),
            'all_arrived':metrics['vehicles_unfinished']==0 and metrics['pedestrians_unfinished']==0}


def export_replay(folder,out,net,rows,meta):
    catalog=[{'id':r['id'],'kind':r['type'],'length':VEH_CLASSES.get(r['type'],(.5,.5))[0],'width':VEH_CLASSES.get(r['type'],(.5,.5))[1]} for r in rows]
    index={r['id']:i for i,r in enumerate(rows)}
    lanes={l['id']:i for i,l in enumerate(meta['geometry']['lanes'])}
    queues=collections.defaultdict(dict)
    peak=collections.defaultdict(float)
    for _,e in ET.iterparse(folder/'queues.xml',events=['end']):
        if e.tag=='interval':
            t=int(float(e.get('begin'))); lane=e.get('id');q=float(e.get('maxJamLengthInMeters'))
            if q>0:queues[t][lane]=round(q,1)
            peak[lane]=max(peak[lane],q);e.clear()
    signals=collections.defaultdict(dict)
    for junction in JUNCTIONS:
        for _,e in ET.iterparse(folder/('signals-'+junction+'.xml'),events=['end']):
            if e.tag=='tlsState':
                t=float(e.get('time'))
                if abs(t-round(t))<.01:signals[round(t)][e.get('id')]=e.get('state')
                e.clear()
    summary={}
    for _,e in ET.iterparse(folder/'summary.xml',events=['end']):
        if e.tag=='step':
            t=float(e.get('time'))
            if abs(t-round(t))<.01:summary[round(t)]={k:int(float(e.get(k,'0'))) for k in ['running','waiting','ended','halting']}
            e.clear()
    frames=[];chunks=[];last_active=0;ped_usage=collections.defaultdict(set)
    def flush():
        if not frames:return
        name='frames-'+str(len(chunks)).zfill(3)+'.json'
        dump(out/name,{'frames':frames})
        chunks.append({'file':name,'start':frames[0]['t'],'end':frames[-1]['t'],'frames':len(frames),'bytes':(out/name).stat().st_size,'sha256':hashlib.sha256((out/name).read_bytes()).hexdigest()})
        frames.clear()
    for _,e in ET.iterparse(folder/'fcd.xml',events=['end']):
        if e.tag!='timestep':continue
        t=int(float(e.get('time')))
        people=[]
        for a in e:
            if a.tag not in ['vehicle','person']:continue
            lane=a.get('lane') or (a.get('edge','')+'_0' if a.tag=='person' else '')
            if a.tag=='person':ped_usage[lane].add(a.get('id'))
            x,y,angle=float(a.get('x')),float(a.get('y')),float(a.get('angle'))
            if a.tag=='vehicle':
                length=catalog[index[a.get('id')]]['length'];radians=math.radians(angle)
                x-=math.sin(radians)*length/2;y-=math.cos(radians)*length/2
            people.append([index[a.get('id')],round(x*100),round(y*100),round(angle,2),round(float(a.get('speed'))*100),lanes.get(lane,-1)])
        if people:last_active=t
        # Stop storing empty tail once demand is over and all agents have left.
        if t>meta['demand_end_s'] and not people and summary.get(t,{}).get('waiting',0)==0:
            e.clear();continue
        frames.append({'t':t,'a':people,'q':[[lanes[k],v] for k,v in queues[t].items() if k in lanes],
                       'signals':signals[t],'counts':summary.get(t,{})})
        if len(frames)>=CHUNK_SECONDS:flush()
        e.clear()
    flush()
    meta['agents']=catalog;meta['chunks']=chunks;meta['duration_s']=last_active+1;meta['sample_s']=SAMPLE
    meta['metrics']['max_lane_queue_m']=round(max(peak.values(),default=0),1)
    meta['metrics']['peak_queues']={k:round(v,1) for k,v in peak.items()}
    meta['metrics']['sidewalk_users']={k:len(v) for k,v in ped_usage.items() if k and not k.startswith(':')}
    dump(out/'manifest.json',meta)
    return meta


def build(args):
    config=validate_config({k:getattr(args,k) for k in DEFAULT_CONFIG})
    for key,value in config.items():setattr(args,key,value)
    bins,version=binaries()
    work=Path(args.work_dir or tempfile.mkdtemp(prefix='rippletwin-sumo-')).resolve();work.mkdir(parents=True,exist_ok=True)
    if any(work.iterdir()):raise ValueError('Work directory must be empty')
    out=Path(args.output).resolve();out.mkdir(parents=True,exist_ok=True)
    if any(out.iterdir()):raise ValueError('Output directory must be empty')
    base=network(work,bins)
    footpath_dir=work/'footpath-net';footpath_dir.mkdir(exist_ok=True)
    footpath_base=network(footpath_dir,bins,footpath=True) if 'footpath' in args.scenarios else None
    rows=demand(args.seed,args.demand_duration_s,args.demand_scale)
    digest=hashlib.sha256(json.dumps(rows,sort_keys=True).encode()).hexdigest()
    dump(work/'shared-demand.json',rows)
    results=[];journeys={};ped_journeys={}
    for scenario in args.scenarios:
        folder=work/scenario;folder.mkdir(exist_ok=True)
        net,diverted=prepare(folder,footpath_base if scenario=='footpath' else base,rows,scenario,args.diversion_share)
        print('Running SUMO:',scenario,flush=True)
        log=run(folder,bins,args.seed,args.demand_duration_s+args.clearance_s)
        m,journey,pj=metrics(folder,rows,diverted,args.diversion_share)
        checked=validation(folder,m,log)
        # Fail export on physical collision, teleport, emergency stop or forced pedestrian escape.
        bad=[s for s in ['collision','teleport','emergency braking','emergency stop','is jammed'] if s in log.lower()]
        if any(value for key,value in checked.items() if key!='all_arrived') or bad:raise RuntimeError('Simulation integrity failure '+scenario+': '+str(checked)+' '+str(bad)+'\n'+log[-5000:])
        if m['vehicles_unfinished'] or m['pedestrians_unfinished']:raise RuntimeError('Demand not cleared; extend horizon or fix the network: '+json.dumps(m))
        meta={'version':1,'agent_columns':['agent_index','x_centimeters','y_centimeters','clockwise_degrees_from_north','speed_centimeters_per_second','lane_index'],'engine':version,'scenario':scenario,'seed':args.seed,'demand_hash':digest,'demand_end_s':args.demand_duration_s,'config':config,
              'coordinate_system':{'kind':'local_cartesian','unit':'m','x':'east','y':'north','position_reference':'center','angle':'clockwise_degrees_from_north','net_offset':[float(x) for x in net.find('location').get('netOffset').split(',')],'georeferenced':False},
              'closed_lanes':(['A_B_2'] if SCENARIOS[scenario]['closed'] else [])+(['A_B_0'] if SCENARIOS[scenario].get('footpath') else []),'metrics':m,'geometry':export_geometry(net),
              'validation':checked,'provenance':{'kind':'native-sumo','generator_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'step_s':STEP,'sample_s':SAMPLE,'agent_position':'center','coordinate_scale':100,'speed_scale':100,'left_hand':True,'synthetic':True,'calibrated':False,'teleport_enabled':False,'collision_check_junctions':True}}
        meta=export_replay(folder,out/scenario,net,rows,meta)
        journeys[scenario]=journey;ped_journeys[scenario]=pj
        results.append(meta)
        print(json.dumps(m,ensure_ascii=False),flush=True)
    baseline=journeys.get('baseline')
    for meta in results:
        k=meta['scenario'];m=meta['metrics']
        if baseline is not None:
            common=set(baseline)&set(journeys[k])
            m['matched_vehicles']=len(common)
            m['extra_journey_s']=round(sum(journeys[k][i]-baseline[i] for i in common),2)
            m['mean_extra_journey_s']=round(m['extra_journey_s']/len(common),2) if common else None
            cp=set(ped_journeys['baseline'])&set(ped_journeys[k])
            m['mean_extra_ped_s']=round(sum(ped_journeys[k][i]-ped_journeys['baseline'][i] for i in cp)/len(cp),2) if cp else None
        dump(out/k/'manifest.json',meta)
    dump(out/'index.json',{'version':1,'engine':version,'seed':args.seed,'config':config,'demand_hash':digest,'scenarios':[{'id':m['scenario'],'manifest':m['scenario']+'/manifest.json','metrics':m['metrics'],'duration_s':m['duration_s']} for m in results]})
    print('Raw audit:',work,'\nReplay:',out)
    return json.loads((out/'index.json').read_text())


DEFAULT_CONFIG = {'seed':42, 'scenarios':list(SCENARIOS), 'demand_duration_s':600,
                  'clearance_s':1200, 'demand_scale':1.0, 'diversion_share':.45}


def validate_config(value):
    if not isinstance(value,dict) or set(value)-set(DEFAULT_CONFIG):
        raise ValueError('Unknown configuration field')
    config={**DEFAULT_CONFIG,**value}
    # Measured on seed 42: demand_scale >=1.5 always fails (collision / not cleared); clearance <600 s fails for short demand.
    for key,lo,hi,integer in [('seed',0,2147483647,True),('demand_duration_s',10,600,True),
                              ('clearance_s',600,2400,True),('demand_scale',.1,1.2,False),('diversion_share',0,1,False)]:
        n=config[key]
        if type(n) not in (int,float) or not math.isfinite(n) or not lo<=n<=hi or (integer and type(n) is not int):
            raise ValueError(f'{key} must be {"an integer" if integer else "a number"} in [{lo}, {hi}]')
    scenarios=config['scenarios']
    if not isinstance(scenarios,list) or not scenarios or any(not isinstance(s,str) or s not in SCENARIOS for s in scenarios) or len(set(scenarios))!=len(scenarios):
        raise ValueError('scenarios must be a nonempty list of unique known scenario IDs')
    config['scenarios']=['baseline']+[s for s in scenarios if s!='baseline']
    return config


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--seed',type=int,default=42)
    parser.add_argument('--scenarios',nargs='+',choices=SCENARIOS,default=list(SCENARIOS))
    parser.add_argument('--demand-duration-s',type=int,default=600)
    parser.add_argument('--clearance-s',type=int,default=1200)
    parser.add_argument('--demand-scale',type=float,default=1)
    parser.add_argument('--diversion-share',type=float,default=.45)
    parser.add_argument('--work-dir')
    parser.add_argument('--output',required=True)
    args=parser.parse_args()
    for k,v in validate_config({k:getattr(args,k) for k in DEFAULT_CONFIG}).items():setattr(args,k,v)
    build(args)
