import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 60;

const getKV = () => ({
  url: process.env.KV_REST_API_URL || '',
  token: process.env.KV_REST_API_TOKEN || '',
});

async function kvGet(key: string): Promise<string | null> {
  const { url, token } = getKV();
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
  const { url, token } = getKV();
  if (!url || !token) return false;
  try {
    const res = await fetch(`${url}/set/${encodeURIComponent(key)}/${encodeURIComponent(value)}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.ok;
  } catch { return false; }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { jsonl, runTotal } = body;
    if (!jsonl || typeof jsonl !== 'string') {
      return NextResponse.json({ error: 'jsonl required' }, { status: 400 });
    }
    const { url, token } = getKV();
    if (!url || !token) {
      return NextResponse.json({ success: true, masterTotal: runTotal || 0, kvAvailable: false });
    }
    const existing = await kvGet('sovereign-health-master') || '';
    const newLines = jsonl.trimEnd();
    const combined = existing ? existing.trimEnd() + '\n' + newLines : newLines;
    await kvSet('sovereign-health-master', combined);
    const total = combined.split('\n').filter(Boolean).length;
    return NextResponse.json({ success: true, savedPairs: runTotal || 0, masterTotal: total, kvAvailable: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function GET() {
  try {
    const { url, token } = getKV();
    if (!url || !token) {
      return NextResponse.json({ error: 'KV not configured' }, { status: 503 });
    }
    const master = await kvGet('sovereign-health-master');
    if (!master) {
      return NextResponse.json({ error: 'No data yet', total: 0 });
    }
    const total = master.split('\n').filter(Boolean).length;
    return new NextResponse(master, {
      headers: {
        'Content-Type': 'application/jsonl',
        'Content-Disposition': `attachment; filename="sovereign-health-master-${total}-pairs.jsonl"`,
        'X-Total-Pairs': String(total),
      },
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
