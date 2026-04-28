'use client';
import { useState, useCallback } from 'react';

const T = "'DM Mono',monospace";
const O = "'Outfit',sans-serif";
const P = "'Playfair Display',serif";

const TOPICS = [
  { id: 'longevity', label: 'Longevity Science', icon: '⏳', color: '#00d4b8', desc: 'Lifespan extension, healthy aging, blue zone research' },
  { id: 'prevention', label: 'Early Prevention', icon: '🔬', color: '#00d4b8', desc: 'Primary prevention, early detection, screening protocols' },
  { id: 'metabolic', label: 'Metabolic Health', icon: '⚡', color: '#d4a843', desc: 'Insulin resistance, prediabetes, metabolic syndrome' },
  { id: 'cardiovascular', label: 'Cardiovascular', icon: '❤️', color: '#e8526e', desc: 'ApoB, Lp(a), coronary calcium, CIMT, heart disease prevention' },
  { id: 'cognitive', label: 'Brain Longevity', icon: '🧠', color: '#8060cc', desc: 'Alzheimers prevention, cognitive decline, dementia risk' },
  { id: 'sleep', label: 'Sleep Science', icon: '😴', color: '#00b89e', desc: 'Sleep apnea, sleep deprivation, recovery optimization' },
  { id: 'exercise', label: 'Exercise and VO2', icon: '🏃', color: '#4ade80', desc: 'Zone 2 cardio, VO2 max, resistance training, longevity' },
  { id: 'nutrition', label: 'Longevity Nutrition', icon: '🥗', color: '#d4a843', desc: 'Mediterranean diet, time-restricted eating, fasting' },
  { id: 'indigenous', label: 'Indigenous Health', icon: '🦅', color: '#d4a843', desc: 'Tribal health, health disparities, ACEs, cultural health factors' },
  { id: 'rural', label: 'Rural Health', icon: '🏘️', color: '#4ade80', desc: 'Rural access barriers, underserved communities, FQHC' },
  { id: 'inflammation', label: 'Inflammation', icon: '🔥', color: '#e8526e', desc: 'hs-CRP, chronic inflammation, inflammaging' },
  { id: 'biomarkers', label: 'Longevity Biomarkers', icon: '🧪', color: '#8060cc', desc: 'Biological age markers, disease prediction, lab panels' },
  { id: 'hormones', label: 'Hormones and Aging', icon: '⚗️', color: '#8060cc', desc: 'Testosterone, DHEA, cortisol, thyroid, hormonal aging' },
  { id: 'microbiome', label: 'Microbiome', icon: '🦠', color: '#4ade80', desc: 'Gut health, microbiota diversity, disease prevention' },
  { id: 'telomere', label: 'Telomere Biology', icon: '🔗', color: '#00d4b8', desc: 'Telomere length, biological aging, cellular senescence' },
  { id: 'epigenetics', label: 'Epigenetic Clocks', icon: '🕐', color: '#8060cc', desc: 'Biological age, epigenetic aging, methylation clocks' },
  { id: 'cancer_prevention', label: 'Cancer Prevention', icon: '🛡️', color: '#e8526e', desc: 'Cancer screening, risk reduction, early detection' },
  { id: 'diabetes', label: 'Diabetes Prevention', icon: '💉', color: '#d4a843', desc: 'Type 2 diabetes prevention, A1C, glucose management' },
  { id: 'hypertension', label: 'Blood Pressure', icon: '📊', color: '#e8526e', desc: 'Hypertension prevention, lifestyle interventions, BP control' },
  { id: 'mental_health', label: 'Mental Health', icon: '💙', color: '#8060cc', desc: 'Depression, ACEs, trauma, mental health and longevity' },
];

interface RunResult {
  totalPairs: number;
  byTopic: Record<string, number>;
  errors: string[];
  jsonl: string;
}

export default function Pipeline() {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [maxPerTopic, setMaxPerTopic] = useState(30);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState('');
  const [result, setResult] = useState<RunResult | null>(null);
  const [totalAllTime, setTotalAllTime] = useState(0);

  const toggleTopic = useCallback((id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => setSelected(new Set(TOPICS.map(t => t.id))), []);
  const selectNone = useCallback(() => setSelected(new Set()), []);

  const selectPreset = useCallback((preset: string) => {
    if (preset === 'core') setSelected(new Set(['longevity','prevention','metabolic','cardiovascular','cognitive','sleep','exercise','nutrition']));
    if (preset === 'indigenous') setSelected(new Set(['indigenous','rural','mental_health','diabetes','hypertension','cardiovascular']));
    if (preset === 'biomarkers') setSelected(new Set(['biomarkers','telomere','epigenetics','inflammation','hormones','microbiome']));
  }, []);

  const runPipeline = useCallback(async () => {
    if (selected.size === 0) return;
    setRunning(true);
    setResult(null);

    const topics = Array.from(selected);
    setProgress(`Connecting to PubMed... searching ${topics.length} topics for up to ${maxPerTopic} articles each...`);

    try {
      const res = await fetch('/api/pipeline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topics, maxPerTopic }),
      });

      setProgress('Fetching abstracts and building training pairs...');
      const data = await res.json();

      if (data.success) {
        setResult(data);
        setTotalAllTime(prev => prev + data.totalPairs);
        setProgress('');
      } else {
        setProgress('Error: ' + (data.error || 'Unknown error'));
      }
    } catch (err) {
      setProgress('Network error: ' + String(err));
    }

    setRunning(false);
  }, [selected, maxPerTopic]);

  const downloadJSONL = useCallback(() => {
    if (!result?.jsonl) return;
    const blob = new Blob([result.jsonl], { type: 'application/jsonl' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sovereign-health-training-${Date.now()}.jsonl`;
    a.click();
    URL.revokeObjectURL(url);
  }, [result]);

  const estimatedPairs = Array.from(selected).length * maxPerTopic;

  return (
    <div style={{ minHeight: '100vh', background: '#07101f', fontFamily: O, color: '#eef2f8', paddingBottom: 80 }}>

      {/* HEADER */}
      <div style={{ background: 'rgba(7,16,31,.97)', borderBottom: '1px solid rgba(0,212,184,.14)', backdropFilter: 'blur(20px)', padding: '14px 18px 12px', position: 'sticky', top: 0, zIndex: 50 }}>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: 'linear-gradient(90deg,transparent,#00d4b8,#d4a843,#8060cc,#00d4b8,transparent)' }}/>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 38, height: 38, borderRadius: 11, background: 'linear-gradient(135deg,#00d4b8,#8060cc)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, boxShadow: '0 0 18px rgba(0,212,184,.3)' }}>⬡</div>
            <div>
              <div style={{ fontFamily: P, fontSize: 16, color: '#eef2f8' }}>Sovereign Health Pipeline</div>
              <div style={{ fontFamily: T, fontSize: 8, color: '#00d4b8', letterSpacing: 2, textTransform: 'uppercase', marginTop: 1 }}>PubMed to Llama Training Data</div>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontFamily: T, fontSize: 18, fontWeight: 700, color: '#4ade80' }}>{totalAllTime.toLocaleString()}</div>
            <div style={{ fontFamily: T, fontSize: 8, color: '#7a9bbf' }}>pairs generated</div>
          </div>
        </div>
      </div>

      <div style={{ padding: '18px 18px 0', maxWidth: 640, margin: '0 auto' }}>

        {/* WHAT THIS DOES */}
        <div style={{ background: 'linear-gradient(135deg,rgba(0,212,184,.08),rgba(128,96,204,.06))', border: '1px solid rgba(0,212,184,.2)', borderRadius: 16, padding: 18, marginBottom: 18 }}>
          <div style={{ fontFamily: T, fontSize: 9, color: '#00d4b8', textTransform: 'uppercase', letterSpacing: 2, marginBottom: 8 }}>What This Does</div>
          <div style={{ fontSize: 12, color: '#7a9bbf', lineHeight: 1.75 }}>Connects directly to the PubMed database at the National Institutes of Health. Pulls peer-reviewed abstracts on every topic you select. Formats every article as a Llama fine-tuning training pair with a system prompt, a user question, and a clinically grounded assistant response. Downloads as JSONL ready to upload directly to Hugging Face for model training.</div>
          <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {['4.5M PubMed Articles','NIH Open Access','Llama Training Format','Direct HuggingFace Upload'].map(tag => (
              <span key={tag} style={{ fontFamily: T, fontSize: 8, color: '#00d4b8', background: 'rgba(0,212,184,.1)', border: '1px solid rgba(0,212,184,.2)', padding: '3px 10px', borderRadius: 20, letterSpacing: 1 }}>{tag.toUpperCase()}</span>
            ))}
          </div>
        </div>

        {/* PRESETS */}
        <div style={{ fontFamily: T, fontSize: 9, color: '#00d4b8', textTransform: 'uppercase', letterSpacing: 2, marginBottom: 8 }}>Quick Presets</div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          {[
            { key: 'core', label: 'Core Longevity', color: '#00d4b8' },
            { key: 'indigenous', label: 'Indigenous and Rural', color: '#d4a843' },
            { key: 'biomarkers', label: 'Biomarker Science', color: '#8060cc' },
          ].map(p => (
            <button key={p.key} onClick={() => selectPreset(p.key)} style={{ padding: '8px 16px', borderRadius: 20, fontSize: 11, fontWeight: 600, cursor: 'pointer', border: `1px solid ${p.color}40`, background: `${p.color}12`, color: p.color, fontFamily: O }}>
              {p.label}
            </button>
          ))}
          <button onClick={selectAll} style={{ padding: '8px 16px', borderRadius: 20, fontSize: 11, fontWeight: 600, cursor: 'pointer', border: '1px solid rgba(74,222,128,.3)', background: 'rgba(74,222,128,.1)', color: '#4ade80', fontFamily: O }}>All Topics</button>
          <button onClick={selectNone} style={{ padding: '8px 16px', borderRadius: 20, fontSize: 11, fontWeight: 600, cursor: 'pointer', border: '1px solid rgba(255,255,255,.1)', background: 'rgba(255,255,255,.04)', color: '#7a9bbf', fontFamily: O }}>Clear</button>
        </div>

        {/* TOPIC GRID */}
        <div style={{ fontFamily: T, fontSize: 9, color: '#00d4b8', textTransform: 'uppercase', letterSpacing: 2, marginBottom: 10 }}>Select Topics — {selected.size} of {TOPICS.length} selected</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 18 }}>
          {TOPICS.map(topic => {
            const isSelected = selected.has(topic.id);
            return (
              <button key={topic.id} onClick={() => toggleTopic(topic.id)}
                style={{ textAlign: 'left', padding: '12px 14px', borderRadius: 12, cursor: 'pointer', fontFamily: O, transition: 'all .2s', border: isSelected ? `1px solid ${topic.color}` : '1px solid rgba(255,255,255,.08)', background: isSelected ? `${topic.color}15` : 'rgba(255,255,255,.04)', outline: 'none' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 16 }}>{topic.icon}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: isSelected ? topic.color : '#eef2f8' }}>{topic.label}</span>
                  {isSelected && <span style={{ marginLeft: 'auto', fontFamily: T, fontSize: 10, color: topic.color }}>✓</span>}
                </div>
                <div style={{ fontSize: 9, color: '#7a9bbf', lineHeight: 1.5 }}>{topic.desc}</div>
              </button>
            );
          })}
        </div>

        {/* SETTINGS */}
        <div style={{ background: 'rgba(255,255,255,.04)', border: '1px solid rgba(0,212,184,.14)', borderRadius: 14, padding: 16, marginBottom: 18 }}>
          <div style={{ fontFamily: T, fontSize: 9, color: '#00d4b8', textTransform: 'uppercase', letterSpacing: 2, marginBottom: 12 }}>Pipeline Settings</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 12, color: '#eef2f8' }}>Articles per topic</span>
            <span style={{ fontFamily: T, fontSize: 14, fontWeight: 700, color: '#00d4b8' }}>{maxPerTopic}</span>
          </div>
          <input type="range" min={10} max={100} step={10} value={maxPerTopic} onChange={e => setMaxPerTopic(Number(e.target.value))}
            style={{ width: '100%', accentColor: '#00d4b8', cursor: 'pointer', marginBottom: 8 }}/>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontFamily: T, fontSize: 9, color: '#7a9bbf' }}>10 articles</span>
            <span style={{ fontFamily: T, fontSize: 9, color: '#7a9bbf' }}>100 articles</span>
          </div>

          <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            {[
              ['Topics', String(selected.size), '#00d4b8'],
              ['Est. Pairs', estimatedPairs.toLocaleString(), '#4ade80'],
              ['Est. Time', Math.ceil(selected.size * maxPerTopic / 60) + ' min', '#d4a843'],
            ].map(([l, v, c]) => (
              <div key={l} style={{ background: 'rgba(255,255,255,.04)', borderRadius: 10, padding: '10px 8px', textAlign: 'center' }}>
                <div style={{ fontFamily: T, fontSize: 16, fontWeight: 700, color: c }}>{v}</div>
                <div style={{ fontSize: 9, color: '#7a9bbf', marginTop: 3 }}>{l}</div>
              </div>
            ))}
          </div>
        </div>

        {/* RUN BUTTON */}
        <button onClick={runPipeline} disabled={running || selected.size === 0}
          style={{ width: '100%', padding: '16px', borderRadius: 14, border: 'none', fontWeight: 700, fontSize: 15, cursor: running || selected.size === 0 ? 'not-allowed' : 'pointer', fontFamily: O, background: running || selected.size === 0 ? 'rgba(0,212,184,.2)' : 'linear-gradient(135deg,#00d4b8,#00b89e)', color: running || selected.size === 0 ? '#7a9bbf' : '#07101f', boxShadow: running || selected.size === 0 ? 'none' : '0 0 24px rgba(0,212,184,.4)', transition: 'all .2s', marginBottom: 12 }}>
          {running ? (
            <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
              <span style={{ display: 'inline-block', width: 16, height: 16, border: '2px solid #7a9bbf', borderTopColor: '#00d4b8', borderRadius: '50%', animation: 'spin 1s linear infinite' }}/>
              Pipeline Running...
            </span>
          ) : selected.size === 0 ? 'Select at least one topic' : `Run Pipeline — ${selected.size} topics, est. ${estimatedPairs.toLocaleString()} pairs`}
        </button>

        {/* PROGRESS */}
        {progress && (
          <div style={{ background: 'rgba(0,212,184,.06)', border: '1px solid rgba(0,212,184,.2)', borderRadius: 12, padding: 14, marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ display: 'inline-block', width: 14, height: 14, border: '2px solid #7a9bbf', borderTopColor: '#00d4b8', borderRadius: '50%', animation: 'spin 1s linear infinite', flexShrink: 0 }}/>
              <span style={{ fontFamily: T, fontSize: 10, color: '#00d4b8' }}>{progress}</span>
            </div>
          </div>
        )}

        {/* RESULTS */}
        {result && (
          <div style={{ animation: 'fadeUp .4s ease' }}>
            <div style={{ background: 'rgba(74,222,128,.06)', border: '1px solid rgba(74,222,128,.25)', borderRadius: 16, padding: 18, marginBottom: 14 }}>
              <div style={{ fontFamily: T, fontSize: 9, color: '#4ade80', textTransform: 'uppercase', letterSpacing: 2, marginBottom: 10 }}>Pipeline Complete</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14 }}>
                <div style={{ fontFamily: T, fontSize: 44, fontWeight: 700, color: '#4ade80', lineHeight: 1 }}>{result.totalPairs.toLocaleString()}</div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#eef2f8' }}>Llama Training Pairs</div>
                  <div style={{ fontSize: 11, color: '#7a9bbf', marginTop: 3 }}>Ready for Hugging Face fine-tuning</div>
                </div>
              </div>

              {/* By topic breakdown */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
                {Object.entries(result.byTopic).map(([topic, count]) => {
                  const topicInfo = TOPICS.find(t => t.id === topic);
                  return (
                    <div key={topic} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 14, flexShrink: 0 }}>{topicInfo?.icon || '📄'}</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                          <span style={{ fontSize: 10, color: '#eef2f8' }}>{topicInfo?.label || topic}</span>
                          <span style={{ fontFamily: T, fontSize: 10, color: '#4ade80' }}>{count} pairs</span>
                        </div>
                        <div style={{ height: 3, background: 'rgba(255,255,255,.06)', borderRadius: 2, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${Math.min(100, (count / maxPerTopic) * 100)}%`, background: topicInfo?.color || '#00d4b8', borderRadius: 2 }}/>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {result.errors.length > 0 && (
                <div style={{ background: 'rgba(232,82,110,.06)', border: '1px solid rgba(232,82,110,.2)', borderRadius: 10, padding: 12, marginBottom: 12 }}>
                  <div style={{ fontFamily: T, fontSize: 9, color: '#e8526e', marginBottom: 6 }}>WARNINGS</div>
                  {result.errors.map((e, i) => <div key={i} style={{ fontSize: 10, color: '#7a9bbf', marginBottom: 3 }}>{e}</div>)}
                </div>
              )}

              <button onClick={downloadJSONL}
                style={{ width: '100%', padding: '14px', borderRadius: 12, border: 'none', background: 'linear-gradient(135deg,#4ade80,#22c55e)', color: '#07101f', fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: O, boxShadow: '0 0 20px rgba(74,222,128,.3)' }}>
                Download JSONL Training File
              </button>
            </div>

            {/* Next steps */}
            <div style={{ background: 'rgba(128,96,204,.06)', border: '1px solid rgba(128,96,204,.2)', borderRadius: 14, padding: 16 }}>
              <div style={{ fontFamily: T, fontSize: 9, color: '#8060cc', textTransform: 'uppercase', letterSpacing: 2, marginBottom: 10 }}>Next Steps — Upload to Hugging Face</div>
              {[
                { step: '1', text: 'Download the JSONL file above' },
                { step: '2', text: 'Go to huggingface.co and open your SovereignShieldTechnologiesLLC organization' },
                { step: '3', text: 'Create a new dataset repository called sovereign-health-training-data' },
                { step: '4', text: 'Upload the JSONL file to the dataset repository' },
                { step: '5', text: 'Point your fine-tuning job at the dataset. Run more pipeline batches to keep adding data.' },
              ].map(s => (
                <div key={s.step} style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
                  <div style={{ width: 22, height: 22, borderRadius: '50%', background: '#8060cc', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: T, fontSize: 10, fontWeight: 700, color: '#eef2f8', flexShrink: 0 }}>{s.step}</div>
                  <div style={{ fontSize: 11, color: '#7a9bbf', lineHeight: 1.6, paddingTop: 2 }}>{s.text}</div>
                </div>
              ))}
              <div style={{ marginTop: 8, fontFamily: T, fontSize: 9, color: '#8060cc' }}>Run the pipeline again anytime to add more training pairs to your dataset. The more you run it the smarter your model gets.</div>
            </div>
          </div>
        )}

        {/* INFO FOOTER */}
        <div style={{ marginTop: 20, background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.06)', borderRadius: 12, padding: 14 }}>
          <div style={{ fontFamily: T, fontSize: 9, color: '#7a9bbf', textTransform: 'uppercase', letterSpacing: 2, marginBottom: 8 }}>Data Sources</div>
          {[
            ['PubMed Central', 'NIH National Library of Medicine — 4.5M open access articles'],
            ['Entrez API', 'Free public API with no authentication required'],
            ['Training Format', 'Llama chat format with system, user, and assistant messages'],
            ['License', 'PubMed abstracts are publicly available for research use'],
          ].map(([k, v]) => (
            <div key={k} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
              <span style={{ fontFamily: T, fontSize: 9, color: '#00d4b8', minWidth: 110, flexShrink: 0 }}>{k}</span>
              <span style={{ fontSize: 10, color: '#7a9bbf' }}>{v}</span>
            </div>
          ))}
        </div>

      </div>
    </div>
  );
}
