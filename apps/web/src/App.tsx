import {useEffect,useState} from 'react';
import './styles.css';

const DEFAULT_SLICE_INDEX=12;
const api=(u:string)=>fetch(u).then(r=>r.json());

type SliceResp={planId:string;index:number;total:number;size:number;data:number[][]};
type SliceStatus={loading:boolean;error?:string;outOfRange?:boolean};

export default function App(){
  const [tab,setTab]=useState('dose');
  const [patient,setPatient]=useState<any>();
  const [plans,setPlans]=useState<any[]>([]);
  const [active,setActive]=useState('PLAN-A');
  const [constraints,setConstraints]=useState<any>();
  const [compare,setCompare]=useState<any>();
  // 断层切片：层号默认 12，total 先以 32 兜底，接口返回后以后端为准
  const [sliceIndex,setSliceIndex]=useState(DEFAULT_SLICE_INDEX);
  const [totalSlices,setTotalSlices]=useState(32);
  const [slice,setSlice]=useState<SliceResp|null>(null);
  const [sliceStatus,setSliceStatus]=useState<SliceStatus>({loading:true});
  const [retryTick,setRetryTick]=useState(0);
  const [reviewer,setReviewer]=useState('');

  useEffect(()=>{
    api('/api/patient/current').then(setPatient);
    api('/api/plans').then(setPlans);
    api('/api/compare').then(setCompare);
  },[]);

  useEffect(()=>{
    if(active) api(`/api/plans/${active}/constraints`).then(setConstraints);
  },[active]);

  // 切换计划或层号时按“当前计划 + 当前层号”重新请求；
  // cancelled 标志 + 先清空旧图，保证加载中/失败/越界时不会把旧图误当成新图
  useEffect(()=>{
    let cancelled=false;
    setSlice(null);
    setSliceStatus({loading:true});
    fetch(`/api/plans/${active}/dose-slice?index=${sliceIndex}`)
      .then(async r=>{
        const body=await r.json().catch(()=>({}));
        if(cancelled)return; // 已被更新的请求取代，丢弃结果
        if(r.status===400&&body.error==='slice_index_out_of_range'){
          setSliceStatus({loading:false,outOfRange:true,
            error:`第 ${body.index} 层超出可阅范围（${body.min}–${body.max} 层），请重新选择层面`});
          return;
        }
        if(!r.ok||body.error){
          setSliceStatus({loading:false,error:'切片加载失败：接口异常，请稍后重试'});
          return;
        }
        setSlice(body);
        if(typeof body.total==='number')setTotalSlices(body.total);
        setSliceStatus({loading:false});
      })
      .catch(()=>{
        if(!cancelled)setSliceStatus({loading:false,error:'切片加载失败：网络异常，请检查后重试'});
      });
    return()=>{cancelled=true;};
  },[active,sliceIndex,retryTick]);

  // 统一入口：切换计划（工具栏下拉、计划对比页点选）后回到默认第 12 层
  const selectPlan=(id:string)=>{
    if(id===active)return;
    setActive(id);
    setSliceIndex(DEFAULT_SLICE_INDEX);
    setSlice(null);
    setSliceStatus({loading:true});
  };

  const commitLayer=(v:number)=>{
    if(!Number.isFinite(v))return;
    setSliceIndex(Math.min(totalSlices-1,Math.max(0,Math.round(v))));
  };

  const activePlan=plans.find(p=>p.id===active);
  // 只有响应与当前计划、当前层号完全一致时才允许渲染，杜绝旧图错位
  const showSlice=slice&&slice.planId===active&&slice.index===sliceIndex&&!sliceStatus.loading&&!sliceStatus.error?slice:null;

  const approve=async()=>{
    const r=await fetch(`/api/plans/${active}/approve`,{method:'POST'}).then(x=>x.json());
    alert(r.approved?'计划已签发':`签发被阻断：${r.failed?.map((x:any)=>x.name).join('、')}`);
  };

  return <main>
    <header>
      <div>
        <span className="eyebrow">RADIATION ONCOLOGY / PLAN QA</span>
        <h1>放射治疗剂量计划验证与器官风险评估系统</h1>
        <p>{patient?.patient?.id} · {patient?.patient?.diagnosis} · 处方 {patient?.patient?.rxDose} Gy / {patient?.patient?.fractions} 次</p>
      </div>
      <div className="badge">物理师复核模式</div>
    </header>
    <nav>{[['dose','剂量阅片'],['constraints','约束校验'],['compare','计划对比']].map(([id,label])=>
      <button key={id} className={tab===id?'active':''} onClick={()=>setTab(id)}>{label}</button>)}
    </nav>
    <section className="toolbar">
      <label>当前计划
        <select value={active} onChange={e=>selectPlan(e.target.value)}>
          {plans.map(p=><option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
      </label>
      <span className={`planStatus ${constraints?.gate}`}>{constraints?.gate==='ready'?'签发门禁通过':'存在约束风险'}</span>
    </section>

    {tab==='dose'&&<section className="grid">
      <div className="panel imagePanel">
        <div className="panelHead">
          <h2>断层切片剂量叠加</h2>
          <span>切片 {sliceIndex} / {totalSlices-1} · 等剂量线：20 / 50 / 95%</span>
        </div>
        <div className="sliceNav">
          <button onClick={()=>setSliceIndex(0)} disabled={sliceIndex===0||sliceStatus.loading}>第 0 层</button>
          <input type="range" min={0} max={totalSlices-1} value={Math.min(sliceIndex,totalSlices-1)}
            disabled={sliceStatus.loading}
            onChange={e=>setSliceIndex(Number(e.target.value))} aria-label="切片层号滑块"/>
          <button onClick={()=>setSliceIndex(totalSlices-1)} disabled={sliceIndex===totalSlices-1||sliceStatus.loading}>最后一层</button>
          <input className="layerInput" type="number" min={0} max={totalSlices-1} value={sliceIndex}
            disabled={sliceStatus.loading}
            onChange={e=>commitLayer(Number(e.target.value))} aria-label="切片层号输入"/>
          <span className="layerMeta">共 {totalSlices} 层（0–{totalSlices-1}）</span>
        </div>
        <div className="slice" style={showSlice?{gridTemplateColumns:`repeat(${showSlice.size},1fr)`}:undefined}>
          {sliceStatus.loading&&<div className="sliceMsg">正在加载 {activePlan?.label??active} 第 {sliceIndex} 层切片…</div>}
          {!sliceStatus.loading&&sliceStatus.error&&<div className="sliceMsg error">
            <b>{sliceStatus.outOfRange?'层面越界':'请求失败'}</b>
            <span>{sliceStatus.error}</span>
            <button onClick={()=>setRetryTick(t=>t+1)}>重新请求当前层</button>
          </div>}
          {showSlice&&showSlice.data.map((row:number[],y:number)=>row.map((v:number,x:number)=>
            <span key={`${x}-${y}`} style={{background:`hsl(${Math.max(0,240-v*2.2)},${v>80?88:55}%,${25+v*.45}%)`}}/>))}
        </div>
        <div className="doseLegend">
          <span className="legendTag">{activePlan?.label??active} · 第 {sliceIndex} 层</span>
          <span style={{background:'#244bd5'}}/>低剂量 <span style={{background:'#f3bb35'}}/>中剂量 <span style={{background:'#ef555b'}}/>高剂量
        </div>
      </div>
      <div className="panel">
        <div className="panelHead"><h2>计划参数</h2><span>{active}</span></div>
        {activePlan&&Object.entries(activePlan).filter(([k])=>!['id','status'].includes(k)).map(([k,v])=>
          <div className="kv" key={k}><span>{k}</span><b>{String(v)}</b></div>)}
        <div className="callout">剂量验证不是单一通过/失败判断，需要同时审查靶区覆盖、危及器官受量、机器跳数和算法版本。</div>
      </div>
    </section>}

    {tab==='constraints'&&<section className="grid">
      <div className="panel">
        <div className="panelHead"><h2>结构约束校验</h2><span>DVH 指标自动计算</span></div>
        {constraints?.checks.map((x:any)=><div className="constraint" key={x.structureId}>
          <div><b>{x.name}</b><small>{x.metric} · 限值 {x.limit}{x.unit}</small></div>
          <strong className={x.pass?'pass':'fail'}>{x.value}{x.unit}</strong>
          <span>{x.pass?'PASS':'FAIL'}</span>
        </div>)}
      </div>
      <div className="panel">
        <div className="panelHead"><h2>DVH 曲线摘要</h2><span>体积-剂量关系</span></div>
        {patient?.structures.map((s:any)=><div className="bar" key={s.id}>
          <span>{s.name}</span>
          <div><i style={{width:`${Math.min(100,(constraints?.checks.find((x:any)=>x.structureId===s.id)?.value??0))}%`}}/></div>
          <b>{constraints?.checks.find((x:any)=>x.structureId===s.id)?.value}</b>
        </div>)}
        <div className="review">
          <input placeholder="复核人姓名" value={reviewer} onChange={e=>setReviewer(e.target.value)}/>
          <button onClick={()=>fetch(`/api/plans/${active}/peer-review`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({reviewer,note:'已完成剂量约束复核'})})}>记录同行复核</button>
          <button onClick={approve}>签发计划</button>
        </div>
      </div>
    </section>}

    {tab==='compare'&&<section className="panel">
      <div className="panelHead"><h2>计划对比与选择</h2><span>同一患者、不同照射技术</span></div>
      <div className="compareGrid">{compare?.plans.map((p:any)=>
        <div key={p.id} className={`compareCard ${p.id===active?'selected':''}`} onClick={()=>selectPlan(p.id)}>
          <h3>{p.label}</h3>
          <strong>{p.targetCoverage}%</strong>
          <small>PTV D95 覆盖</small>
          <p>MU {p.mu} · 约束失败 {p.checks.filter((x:any)=>!x.pass).length} 项</p>
          {p.checks.map((x:any)=><div key={x.structureId} className={x.pass?'tinyPass':'tinyFail'}>{x.name}: {x.value}{x.unit}</div>)}
        </div>)}
      </div>
      <div className="recommend">系统建议：{compare?.recommendation}</div>
    </section>}
  </main>;
}
