import {parseArgs} from 'node:util';
import {tableLabel} from '../src/named-baskets.js';
import {shoppingItems} from 'paguemenos-cli/plan';

export const planUsage='farmacias plan "medicamento A" "medicamento B" [--retailer ID | --retailers ID,ID] (--cep CEP | --lat LAT --lon LON) [--brand-only A] [--include-generics B] [--quantity A=2] [--store nearest | --expand]';

export function planArgs(argv) {
  const args=[];
  for (let i=0;i<argv.length;i++) {
    const arg=argv[i];
    if (['--lat','--lon'].includes(arg) && /^-\d+(?:\.\d+)?$/.test(argv[i+1] ?? '')) {
      args.push(arg+'='+argv[++i]);
    } else args.push(arg);
  }
  const {values:v,positionals}=parseArgs({args,allowPositionals:true,options:{
    retailer:{type:'string'},retailers:{type:'string'},cep:{type:'string'},lat:{type:'string'},lon:{type:'string'},
    store:{type:'string'},expand:{type:'boolean'},json:{type:'boolean'},
    ...Object.fromEntries(['quantity','sku','brand','generic','brand-only','include-generics'].map(name=>[name,{type:'string',multiple:true}])),
  }});
  if(v.cep!==undefined && (v.lat!==undefined || v.lon!==undefined)) throw Error('Informe apenas uma origem.');
  const origin=v.cep!==undefined ? {zipcode:v.cep} : {
    latitude:v.lat?.trim()?Number(v.lat):NaN,longitude:v.lon?.trim()?Number(v.lon):NaN,
  };
  const scoped=[],bare=[];
  for (const choice of v.sku ?? []) {
    const match=/^([A-Z]+)=([a-z]+):(\d+)$/i.exec(choice);
    if (match) scoped.push(match); else bare.push(choice);
  }
  const items=shoppingItems(positionals,{...v,sku:bare});
  const byLabel = new Map(items.map((item,i)=>[tableLabel(i),item]));
  for(const [,label,id,sku] of scoped) {
    const line=byLabel.get(label.toUpperCase());
    if(!line || line.selectedSkus?.[id]) throw Error('Seleção de SKU inválida para '+label+'.');
    line.selectedSkus={...line.selectedSkus,[id]:sku};
  }
  return {origin,items:items.map(({sku,...rest})=>({...rest,...(sku && {selectedSku:sku})})),retailer:v.retailer,
    retailers:v.retailers?.split(',').map(s=>s.trim()),store:v.store,expandSearch:v.expand};
}
