import { NextRequest, NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';

export const runtime = 'nodejs';
export const maxDuration = 60;

const KEY = 'sovereign-health-master';

function getRedis(): Redis | null {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { jsonl, runTotal } = body;
    if (!jsonl || typeof jsonl !== 'string') {
      return NextResponse.json({ error: 'jsonl required' }, { status: 400 });
    }
    const redis = getRedis();
    if (!redis) {
      return NextResponse.json({ success: true, masterTotal: runTotal || 0, kvAvailable: false });
    }
    const chunk = jsonl.endsWith('\n') ? jsonl : jsonl + '\n';
    await redis.append(KEY, chunk);
    const master = await redis.get<string>(KEY);
    const total = master ? master.split('\n').filter(Boolean).length : 0;
    return NextResponse.json({
      success: true,
      savedPairs: runTotal || 0,
      masterTotal: total,
      kvAvailable: true,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const redis = getRedis();
    if (!redis) {
      return NextResponse.json({ error: 'KV not configured', total: 0 }, { status: 503 });
    }
    const wantCount = new URL(req.url).searchParams.get('count') === 'true';
    const master = await redis.get<string>(KEY);
    const total = master ? master.split('\n').filter(Boolean).length : 0;
    if (wantCount) {
      return NextResponse.json({ total });
    }
    if (!master) {
      return NextResponse.json({ error: 'No data yet', total: 0 });
    }
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
