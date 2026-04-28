import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 60;

async function kvGet(key: string): Promise<string | null> {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  try {
    const res = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.result ?? null;
  } catch { return null; }
}

async function kvSet(key: string, value: string): Promise<boolean> {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return false;
  try {
    const res = await fetch(`${url}/set/${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ value }),
    });
    return res.ok;
  } catch { return false; }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { jsonl, runTotal } = body;
    if (!jsonl || typeof jsonl !== 'string') {
      return NextResponse.json({ error: 'jsonl string required' }, { status: 400 });
    }
    const url = process.env.KV_REST_API_URL;
    const token = process.env.KV_REST_API_TOKEN;
    if (!url || !token) {
      return NextResponse.json({ success: true, masterTotal: runTotal || 0, kvAvailable: false, message: 'KV not configured. Add Vercel KV in your dashboard.' });
    }
    const existing = await kvGet('sovereign-health-master') || '';
    const combined = existing ? existing.trimEnd() + '\n' + jsonl.trimEnd() : jsonl.trimEnd();
    await kvSet('sovereign-health-master', combined);
    const total = combined.split('\n').filter(Boolean).length;
    return NextResponse.json({ success: true, savedPairs: runTotal || 0, masterTotal: total, kvAvailable: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function GET() {
  try {
    const url = process.env.KV_REST_API_URL;
    const token = process.env.KV_REST_API_TOKEN;
    if (!url || !token) {
      return NextResponse.json({ error: 'Vercel KV not configured. Go to Vercel dashboard, click Storage, create a KV database, and connect it to this project.', kvAvailable: false }, { status: 503 });
    }
    const master = await kvGet('sovereign-health-master');
    if (!master) {
      return NextResponse.json({ error: 'No data yet. Run the pipeline first.', total: 0 });
    }
    const total = master.split('\n').filter(Boolean).length;
    const filename = `sovereign-health-master-${total}-pairs-${Date.now()}.jsonl`;
    return new NextResponse(master, {
      headers: {
        'Content-Type': 'application/jsonl',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'X-Total-Pairs': String(total),
      },
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
