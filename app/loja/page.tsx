import { redirect } from 'next/navigation.js';

export default async function LegacyStorePage({searchParams}:{searchParams:Promise<{loja?:string}>}) {
 const {loja}=await searchParams;
 if(loja && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(loja) && loja!=='loja') redirect('/'+loja);
 return <main className="access-shell"><section className="access-card"><h1>Acesse o link do seu açougue</h1><p>Cada loja tem sua própria página de pedidos. Peça o endereço ao açougue para consultar o catálogo e comprar.</p><a className="primary-button" href="/">Sou açougueiro: acessar meu painel</a></section></main>;
}
