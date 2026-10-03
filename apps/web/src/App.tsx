import {Fragment, useEffect, useRef, useState} from 'react';
import './styles.css';

const DEFAULT_SLICE_INDEX = 12;
const api = (u: string) => fetch(u).then(r => r.json());

type DoseLevel = {color: string; label: string};
type SliceResponse = {
  planId: string;
  index: number;
  size: number;
  sliceCount: number;
  legend: DoseLevel[];
  data: number[][];
};
type SliceErrorBody = {error?: string; sliceCount?: number; message?: string};
type SliceState =
  | {status: 'loading'; planId: string; index: number}
  | {status: 'ready'; res: SliceResponse}
  | {status: 'out_of_range'; planId: string; index: number; sliceCount: number; message: string}
  | {status: 'error'; planId: string; index: number; message: string};

const PLAN_FIELD_LABELS: Record<string, string> = {
  label: '计划名称', beamCount: '射野数', energy: '能量', algorithm: '剂量算法',
  mu: '机器跳数 (MU)', createdAt: '创建时间', status: '状态', sliceCount: '断层层数',
};

export default function App() {
  const [tab, setTab] = useState('dose');
  const [patient, setPatient] = useState<any>();
  const [plans, setPlans] = useState<any[]>([]);
  const [active, setActive] = useState('PLAN-A');
  const [constraints, setConstraints] = useState<any>();
  const [compare, setCompare] = useState<any>();
  const [reviewer, setReviewer] = useState('');

  const [sliceIndex, setSliceIndex] = useState(DEFAULT_SLICE_INDEX);
  const [sliceState, setSliceState] = useState<SliceState>({status: 'loading', planId: 'PLAN-A', index: DEFAULT_SLICE_INDEX});
  const [reloadNonce, setReloadNonce] = useState(0);
  const [indexDraft, setIndexDraft] = useState(String(DEFAULT_SLICE_INDEX));
  const sliceReqId = useRef(0);

  useEffect(() => {
    api('/api/patient/current').then(setPatient);
    api('/api/plans').then(setPlans);
    api('/api/compare').then(setCompare);
  }, []);

  useEffect(() => {
    let alive = true;
    api(`/api/plans/${active}/constraints`).then(c => { if (alive) setConstraints(c); });
    return () => { alive = false; };
  }, [active]);

  // 切换计划 / 层号 / 重试时，按“当前计划 + 当前层号”重新请求切片。
  // loading 与错误态都会清空旧图，避免旧图被误当成新层面。
  useEffect(() => {
    const reqId = ++sliceReqId.current;
    setSliceState({status: 'loading', planId: active, index: sliceIndex});
    fetch(`/api/plans/${active}/dose-slice?index=${sliceIndex}`)
      .then(async r => {
        const body = await r.json().catch(() => ({} as SliceErrorBody));
        if (reqId !== sliceReqId.current) return; // 过期响应（用户已继续切换），丢弃
        if (r.ok) {
          const res = body as SliceResponse;
          // 双保险：响应必须属于当前计划与请求层，否则视为失败而非沿用旧图
          if (res.planId !== active || res.index !== sliceIndex || !Array.isArray(res.data)) {
            setSliceState({status: 'error', planId: active, index: sliceIndex, message: '切片响应与当前计划/层号不一致'});
            return;
          }
          setSliceState({status: 'ready', res});
        } else if (r.status === 416) {
          const b = body as SliceErrorBody;
          setSliceState({
            status: 'out_of_range', planId: active, index: sliceIndex,
            sliceCount: b.sliceCount ?? 0,
            message: b.message || `层号 ${sliceIndex} 越界`,
          });
        } else {
          const b = body as SliceErrorBody;
          setSliceState({status: 'error', planId: active, index: sliceIndex, message: b.message || `接口返回 ${r.status}`});
        }
      })
      .catch(() => {
        if (reqId !== sliceReqId.current) return;
        setSliceState({status: 'error', planId: active, index: sliceIndex, message: '网络错误或服务不可用'});
      });
  }, [active, sliceIndex, reloadNonce]);

  // 数字输入框跟随已生效的层号
  useEffect(() => { setIndexDraft(String(sliceIndex)); }, [sliceIndex]);

  const planSliceCount = plans.find(p => p.id === active)?.sliceCount as number | undefined;
  const lastIndex = (sliceState.status === 'ready' ? sliceState.res.sliceCount : planSliceCount) ?? 0;

  // 切换计划时把层号钳制到新计划的有效范围（PLAN-B 只有 28 层）
  const choosePlan = (id: string) => {
    if (id === active) return;
    const count = plans.find(p => p.id === id)?.sliceCount;
    const clamped = typeof count === 'number' ? Math.min(sliceIndex, count - 1) : sliceIndex;
    sliceReqId.current++; // 使旧计划的在途请求立即过期
    setActive(id);
    setSliceIndex(clamped);
    setIndexDraft(String(clamped));
    setSliceState({status: 'loading', planId: id, index: clamped});
  };

  const gotoIndex = (i: number) => {
    if (lastIndex) setSliceIndex(Math.max(0, Math.min(i, lastIndex - 1)));
    else setSliceIndex(Math.max(0, i));
  };
  const commitIndexInput = () => {
    const n = Number(indexDraft);
    if (Number.isInteger(n)) {
      // 越界不做本地钳制：照常请求，由后端返回 416 展示越界态
      setSliceIndex(n < 0 ? 0 : n);
    } else {
      setIndexDraft(String(sliceIndex));
    }
  };

  const approve = async () => {
    const r = await fetch(`/api/plans/${active}/approve`, {method: 'POST'}).then(x => x.json());
    alert(r.approved ? '计划已签发' : `签发被阻断：${r.failed?.map((x: any) => x.name).join('、')}`);
  };

  const loading = sliceState.status === 'loading';
  const ready = sliceState.status === 'ready' ? sliceState.res : null;
  const shownIndex = ready ? ready.index : sliceIndex;
  const shownCount = ready ? ready.sliceCount : lastIndex;
  const legend: DoseLevel[] | null = ready ? ready.legend : null;

  return <main>
    <header>
      <div>
        <span className="eyebrow">RADIATION ONCOLOGY / PLAN QA</span>
        <h1>放射治疗剂量计划验证与器官风险评估系统</h1>
        <p>{patient?.patient?.id} · {patient?.patient?.diagnosis} · 处方 {patient?.patient?.rxDose} Gy / {patient?.patient?.fractions} 次</p>
      </div>
      <div className="badge">物理师复核模式</div>
    </header>
    <nav>{[['dose', '剂量阅片'], ['constraints', '约束校验'], ['compare', '计划对比']].map(([id, label]) =>
      <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>)}
    </nav>
    <section className="toolbar">
      <label>当前计划
        <select value={active} onChange={e => choosePlan(e.target.value)}>
          {plans.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
      </label>
      <span className={`planStatus ${constraints?.gate}`}>{constraints?.gate === 'ready' ? '签发门禁通过' : '存在约束风险'}</span>
    </section>

    {tab === 'dose' && <section className="grid">
      <div className="panel imagePanel">
        <div className="panelHead">
          <h2>断层切片剂量叠加</h2>
          <span>
            {sliceState.status === 'out_of_range'
              ? `层号 ${sliceState.index} 超出范围（0–${sliceState.sliceCount - 1}）`
              : <>切片 {shownIndex} / {shownCount ? shownCount - 1 : '—'}
                {legend ? ` · 等剂量线：${legend[0].label.match(/(\d+)%/)?.[1]} / ${legend[legend.length - 1].label.match(/(\d+)%/)?.[1]}%` : ''}</>}
          </span>
        </div>

        <div className="sliceControl">
          <button disabled={loading || shownIndex <= 0} onClick={() => gotoIndex(0)} title="第 0 层">⏮</button>
          <button disabled={loading || shownIndex <= 0} onClick={() => gotoIndex(shownIndex - 1)}>上一层</button>
          <input
            type="range" min={0} max={Math.max(0, shownCount - 1)} step={1}
            value={Math.min(shownIndex, Math.max(0, shownCount - 1))}
            disabled={loading || !shownCount}
            onChange={e => gotoIndex(Number(e.target.value))}
          />
          <button disabled={loading || (shownCount > 0 && shownIndex >= shownCount - 1)} onClick={() => gotoIndex(shownIndex + 1)}>下一层</button>
          <button disabled={loading || (shownCount > 0 && shownIndex >= shownCount - 1)} onClick={() => gotoIndex(shownCount - 1)} title="最后一层">⏭</button>
          <span className="sliceIndexInput">层号
            <input
              type="number" min={0} max={shownCount - 1} value={indexDraft}
              disabled={loading || !shownCount}
              onChange={e => setIndexDraft(e.target.value)}
              onBlur={commitIndexInput}
              onKeyDown={e => e.key === 'Enter' && commitIndexInput()}
            />/ {shownCount ? shownCount - 1 : '—'}
          </span>
        </div>

        <div className={`slice ${sliceState.status === 'ready' ? '' : 'sliceMessage'}`} style={ready ? {gridTemplateColumns: `repeat(${ready.size},1fr)`} : undefined}>
          {ready ? ready.data.map((row: number[], y: number) => row.map((v: number, x: number) =>
            <span key={`${x}-${y}`} style={{background: `hsl(${Math.max(0, 240 - v * 2.2)},${v > 80 ? 88 : 55}%,${25 + v * .45}%)`}} />)) : null}
          {sliceState.status === 'loading' && <div className="sliceNote"><i className="spinner" />正在请求计划 {sliceState.planId} 第 {sliceState.index} 层切片…</div>}
          {sliceState.status === 'out_of_range' && <div className="sliceNote error">
            层号 {sliceState.index} 越界：该计划共 {sliceState.sliceCount} 层（0–{sliceState.sliceCount - 1}），未显示图像。
            <button onClick={() => gotoIndex(sliceState.sliceCount - 1)}>跳到最后一层</button>
          </div>}
          {sliceState.status === 'error' && <div className="sliceNote error">
            切片加载失败：{sliceState.message}（计划 {sliceState.planId} · 第 {sliceState.index} 层），旧图已清除。
            <button onClick={() => setReloadNonce(n => n + 1)}>重试</button>
          </div>}
        </div>
        <div className="doseLegend">
          {legend ? legend.map(l => <Fragment key={l.label}><span style={{background: l.color}} />{l.label}</Fragment>)
            : <span className="legendMuted">图例随当前计划切片加载{loading ? '中…' : '，加载失败或越界时不可用'}</span>}
        </div>
      </div>

      <div className="panel">
        <div className="panelHead"><h2>计划参数</h2><span>{active}</span></div>
        {plans.find(p => p.id === active) && Object.entries(plans.find(p => p.id === active))
          .filter(([k]) => k !== 'id')
          .map(([k, v]) => <div className="kv" key={k}><span>{PLAN_FIELD_LABELS[k] ?? k}</span><b>{String(v)}</b></div>)}
        <div className="callout">剂量验证不是单一通过/失败判断，需要同时审查靶区覆盖、危及器官受量、机器跳数和算法版本。</div>
      </div>
    </section>}

    {tab === 'constraints' && <section className="grid">
      <div className="panel">
        <div className="panelHead"><h2>结构约束校验</h2><span>DVH 指标自动计算</span></div>
        {constraints?.checks.map((x: any) => <div className="constraint" key={x.structureId}>
          <div><b>{x.name}</b><small>{x.metric} · 限值 {x.limit}{x.unit}</small></div>
          <strong className={x.pass ? 'pass' : 'fail'}>{x.value}{x.unit}</strong>
          <span>{x.pass ? 'PASS' : 'FAIL'}</span>
        </div>)}
      </div>
      <div className="panel">
        <div className="panelHead"><h2>DVH 曲线摘要</h2><span>体积-剂量关系</span></div>
        {patient?.structures.map((s: any) => <div className="bar" key={s.id}>
          <span>{s.name}</span>
          <div><i style={{width: `${Math.min(100, (constraints?.checks.find((x: any) => x.structureId === s.id)?.value ?? 0))}%`}} /></div>
          <b>{constraints?.checks.find((x: any) => x.structureId === s.id)?.value}</b>
        </div>)}
        <div className="review">
          <input placeholder="复核人姓名" value={reviewer} onChange={e => setReviewer(e.target.value)} />
          <button onClick={() => fetch(`/api/plans/${active}/peer-review`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({reviewer, note: '已完成剂量约束复核'})})}>记录同行复核</button>
          <button onClick={approve}>签发计划</button>
        </div>
      </div>
    </section>}

    {tab === 'compare' && <section className="panel">
      <div className="panelHead"><h2>计划对比与选择</h2><span>同一患者、不同照射技术</span></div>
      <div className="compareGrid">{compare?.plans.map((p: any) =>
        <div key={p.id} className={`compareCard ${p.id === active ? 'selected' : ''}`} onClick={() => choosePlan(p.id)}>
          <h3>{p.label}</h3>
          <strong>{p.targetCoverage}%</strong>
          <small>PTV D95 覆盖</small>
          <p>MU {p.mu} · 约束失败 {p.checks.filter((x: any) => !x.pass).length} 项</p>
          {p.checks.map((x: any) => <div key={x.structureId} className={x.pass ? 'tinyPass' : 'tinyFail'}>{x.name}: {x.value}{x.unit}</div>)}
        </div>)}
      </div>
      <div className="recommend">系统建议：{compare?.recommendation}</div>
    </section>}
  </main>;
}
