"use client"

import { useEffect, useState, type FormEvent } from 'react';
import { formatMinor } from '../../lib/cart.ts';

type Item = { id:string; productName:string; preparationName:string; pricingType:string; requestedQty:string; reservedQty:string; finalQty:string|null; estimatedTotalMinor:string; finalTotalMinor:string|null; customerNote:string|null; status:string };
type Details = { order:{ publicNumber:string; customerName:string; fulfillmentStatus:string; currency:string; estimatedTotalMinor:string; finalTotalMinor:string|null }; items:Item[]; canWeigh:boolean };
const labels:Record<string,string>={PENDING:'A pesar',SEPARATING:'Em separação',WEIGHING:'Em pesagem',WAITING_CUSTOMER_APPROVAL:'Aguardando aprovação do cliente',RESOLVED:'Peso confirmado',CANCELED:'Cancelado'};

export function OrderWeighing({orderId,onClose,onChanged}:{orderId:string;onClose:()=>void;onChanged:()=>Promise<unknown>}) {
  const [data,setData]=useState<Details|null>(null),[error,setError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[revision,setRevision]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();setData(null);setError('');
    fetch(`/api/orders/${orderId}`,{cache:'no-store',signal:controller.signal}).then(async response=>{const body=await response.json();if(!response.ok)throw new Error(body.error?.message??'Não foi possível carregar o pedido.');return body as Details;}).then(setData).catch(value=>{if(!controller.signal.aborted)setError(value instanceof Error?value.message:'Falha ao carregar.');});
    return ()=>controller.abort();
  },[orderId,revision]);
  async function weigh(event:FormEvent<HTMLFormElement>,item:Item){
    event.preventDefault();if(busy)return;
    const finalQty=String(new FormData(event.currentTarget).get('finalQty')??'');
    if(!/^[1-9][0-9]{0,18}$/.test(finalQty)||BigInt(finalQty)>BigInt(item.reservedQty)){setError('Informe uma quantidade inteira, maior que zero e dentro da reserva.');return;}
    setBusy(true);setError('');setMessage('');
    try{
      const response=await fetch(`/api/orders/${orderId}/items/${item.id}/weigh`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({finalQty})});
      const body=await response.json();
      if(!response.ok)throw new Error(body.error?.message??'Não foi possível registrar a pesagem. Atualize o pedido.');
      setMessage(body.requiresApproval?'Pesagem registrada. O cliente precisa aprovar a alteração no acompanhamento.':'Pesagem registrada com sucesso.');
      setRevision(value=>value+1);
      await onChanged();
    }catch(value){setError(value instanceof Error?value.message:'Falha ao registrar. Atualize o pedido antes de tentar novamente.');}
    finally{setBusy(false);}
  }
  return <section className="table-card product-editor" aria-labelledby="weigh-title">
    <div className="section-heading"><h2 id="weigh-title">{data?`Pesagem do pedido #${data.order.publicNumber}`:'Detalhes do pedido'}</h2><button className="filter-button" disabled={busy} onClick={onClose}>Voltar à fila</button></div>
    {error&&<p className="form-error" role="alert">{error}</p>}{message&&<p className="status-banner" role="status">{message}</p>}
    <button className="text-button" disabled={busy} onClick={()=>setRevision(value=>value+1)}>Atualizar pedido</button>
    {!data&&!error&&<p role="status">Carregando itens…</p>}
    {data&&<><p>{data.order.customerName}</p><p>Informe o peso em gramas (ex.: 1,250 kg = 1250 g) ou a quantidade de unidades. O registro realiza a baixa de estoque.</p>
      {!data.canWeigh&&<p className="status-banner">Pesagem indisponível para seu acesso ou para a etapa atual deste pedido.</p>}
      {data.items.map(item=><article className="weigh-item" key={item.id}><h3>{item.productName} · {item.preparationName}</h3><p>{labels[item.status]??item.status}</p><p>Solicitado: {item.requestedQty} {item.pricingType==='PER_KG'?'g':'un.'} · Reserva: {item.reservedQty} {item.pricingType==='PER_KG'?'g':'un.'}</p>{item.customerNote&&<p>Observação: {item.customerNote}</p>}
        {item.finalQty&&<p>Separado: {item.finalQty} {item.pricingType==='PER_KG'?'g':'un.'} · {formatMinor(item.finalTotalMinor??item.estimatedTotalMinor,data.order.currency)}</p>}
        {data.canWeigh&&['PENDING','SEPARATING','WEIGHING'].includes(item.status)&&item.pricingType!=='FIXED_PACKAGE'&&<form className="editor-form" onSubmit={event=>void weigh(event,item)}><label>Quantidade final ({item.pricingType==='PER_KG'?'gramas':'unidades'})<input name="finalQty" inputMode="numeric" pattern="[1-9][0-9]*" maxLength={19} defaultValue={item.requestedQty} required disabled={busy}/></label><button className="primary-button" disabled={busy}>{busy?'Registrando…':'Registrar pesagem'}</button></form>}
      </article>)}<p><strong>{data.order.finalTotalMinor===null?'Estimativa':'Total final'}: {formatMinor(data.order.finalTotalMinor??data.order.estimatedTotalMinor,data.order.currency)}</strong></p></>}
  </section>;
}
