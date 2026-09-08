import fs from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { parseArgs } from 'node:util';
import { buildHistoricalFactorFrames, enqueueResearchFrames, normalizeFactorLibraryConfig, startFactorResearch } from './factor-library.mjs';
// Input: directory of {symbol,klines: Binance-format rows} .json.gz files.
const { values: options, positionals } = parseArgs({ allowPositionals: true, options: {
  from: { type: 'string' }, until: { type: 'string' }, coarse: { type: 'string' }, 'queue-only': { type: 'boolean' }, source: { type: 'string' }
} });
const directory=positionals[0];
if(!directory) throw new Error('usage: npm run research:import -- DIRECTORY [last-bars]');
const limit=Number(positionals[1]) || Infinity;
const fundingBySymbol = {};
const convert = r=>({time:Number(r[0]),open:Number(r[1]),high:Number(r[2]),low:Number(r[3]),close:Number(r[4]),volume:Number(r[5]),quoteVolume:Number(r[7]),trades:Number(r[8]),takerBuyVolume:Number(r[9]),takerBuyQuoteVolume:Number(r[10])});
const seriesBySymbol=Object.fromEntries(fs.readdirSync(directory).filter(n=>n.endsWith('.json.gz')).map(name=>{
  const d=JSON.parse(gunzipSync(fs.readFileSync(path.join(directory,name))));
  if(!/^[A-Z0-9]+USDT$/.test(d.symbol)||!Array.isArray(d.klines)) throw new Error('invalid_candle_archive');
  if (options.source && d.verified !== true) throw new Error('verified_archives_required');
  fundingBySymbol[d.symbol] = d.okxFunding || [];
  const rows=d.klines.slice(-limit).map(convert);
  for(let i=1;i<rows.length;i++) if(rows[i].time<=rows[i-1].time) throw new Error('candles_not_strictly_ordered');
  return [d.symbol,rows];
}));
const names=Object.keys(seriesBySymbol);if(names.length<8) throw new Error('cross_section_requires_8_symbols');
const first=seriesBySymbol[names[0]], interval=(first[1].time-first[0].time)/60000;
if(![1,5,15,60].includes(interval)) throw new Error('unsupported_candle_interval');
for(const rows of Object.values(seriesBySymbol)) for(let i=0;i<rows.length;i++) {
  const c=rows[i];
  if(![c.open,c.high,c.low,c.close,c.volume].every(Number.isFinite) || c.low<=0 || c.volume<0 || c.low>Math.min(c.open,c.close) || c.high<Math.max(c.open,c.close)) throw new Error('invalid_ohlcv');
  if(i && c.time-rows[i-1].time!==interval*60000) throw new Error('missing_candle_no_interpolation');
}
const series15mBySymbol = options.coarse ? Object.fromEntries(names.map(n=> {
  const d=JSON.parse(gunzipSync(fs.readFileSync(path.join(options.coarse,`${n}.json.gz`))));
  if(d.symbol!==n || d.interval!=='15m' || !d.verified) throw new Error('invalid_auxiliary_candles');
  return [n,d.klines.map(convert)];
})) : {};
const from = options.from ? Date.parse(options.from) : -Infinity, until = options.until ? Date.parse(options.until) : Infinity;
if(Number.isNaN(from) || Number.isNaN(until) || from>=until) throw new Error('invalid_time_range');
const runtime=path.resolve(process.env.SIGNAL_RUNTIME_DIR || '.runtime/event-signal-monitor');
let raw={};try{raw=JSON.parse(fs.readFileSync(path.join(runtime,'factor-library-config.json'),'utf8'));}catch{}
const config=normalizeFactorLibraryConfig(raw);let framesCount=0;
// Overlapping warmup preserves feature causality while keeping temporary memory bounded.
for(let offset=0;offset<first.length;offset+=1000){
  if(first[Math.min(offset+999,first.length-1)].time+interval*60000 < from || first[offset].time+interval*60000>=until) continue;
  const start=Math.max(0,offset-120), end=offset+1000;
  const slice=Object.fromEntries(names.map(n=>[n,seriesBySymbol[n].filter(c=>c.time>=first[start].time && c.time<=(first[Math.min(end,first.length)-1]?.time || Infinity))]));
  const frames=buildHistoricalFactorFrames({seriesBySymbol:slice,series15mBySymbol,fundingBySymbol,intervalMinutes:interval}).filter(f=> {
    const t=Date.parse(f.capturedAt), minute=new Date(t).getUTCMinutes();
    return t>=first[offset].time+interval*60000 && t>=from && t<until && [0,5,15].includes(minute);
  });
  const packet=frames.map(f=>({t:Math.floor(Date.parse(f.capturedAt)/1000),intervalSeconds:3600,
    symbols:Object.fromEntries(Object.entries(f.prices).map(([symbol,price])=>[symbol,{price,values:f.values[symbol] || {},cost:.0016}]))}));
  enqueueResearchFrames(packet,config,options.source || 'historical_public_candles');framesCount+=packet.length;
}
console.log(JSON.stringify({queuedFrames:framesCount,symbols:names.length,intervalMinutes:interval,costAssumption:.0016,
  fundingFeatureSource:'okx_settled_asof_minus_60s',fiveMinuteLabelsAvailable:interval<=5,
  worker:options['queue-only'] ? 'not_started' : startFactorResearch(config,'evaluate')}));
