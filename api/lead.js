// Serverless (Vercel) — recebe o formulário do navegador e encaminha ao CRM.
// Existe para que o segredo (FORM_WEBHOOK_SECRET) fique no servidor:
// se o navegador chamasse o CRM direto, o segredo ficaria visível no código da página.
//
// Desde a mudança para o CRM da Lume, este arquivo também traduz: a página fala
// "name/phone/06 - Faturamento mensal líquido", e o CRM espera nome, whatsapp e
// uma lista de respostas com nomes limpos. A tradução mora aqui porque o
// formulário roda em produção captando lead de anúncio — mexer na página seria
// arriscar a captação para ganhar nada.
async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch (_) {} }
  return await new Promise((resolve) => {
    let d = '';
    req.on('data', (c) => (d += c));
    req.on('end', () => { try { resolve(JSON.parse(d)); } catch (_) { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

// CRM da Lume: o apelido na URL é quem diz de qual cliente é este formulário.
const CRM_LUME = process.env.CRM_LUME_ENDPOINT
  || 'https://lume-solutions.vercel.app/api/formulario?f=raquel-qualificacao';

// CRM antigo. Continua recebendo enquanto os dois convivem; se ele falhar,
// o lead não se perde — quem manda no sucesso da página é o CRM da Lume.
const CRM_ANTIGO = process.env.CRM_FORM_ENDPOINT
  || 'https://crm-raquel.vercel.app/api/public/form-submission';

/** O que a página manda vira o que o CRM da Lume entende. */
function paraLume(b) {
  return {
    nome: b.name || '',
    whatsapp: b.phone || '',
    email: b.email || '',
    campos: {
      // O texto amigável é o que a pessoa leu na tela; o valor cru é o que a
      // Raquel usa para rotear. Os dois vão: um serve para o agente conversar,
      // o outro para a régua de qualificação.
      'faturamento': b['06 - Faturamento mensal líquido'] || '',
      'faixa-faturamento': b.faturamento || '',
      'tipo-divida': b['08 - Origem das dívidas'] || '',
      'valor-divida': b['09 - Valor aproximado das dívidas'] || '',
      'prioridade': b.prioridade || '',
      'qualificacao': b.qualificacao || '',
      'pagina': b['13 - Página de origem'] || '',
      'utm-source': b['15 - UTM Origem'] || '',
      'utm-medium': b['16 - UTM Mídia'] || '',
      'utm-campaign': b['17 - UTM Campanha'] || '',
      'utm-content': b['18 - UTM Conteúdo'] || '',
      'utm-term': b['19 - UTM Termo'] || '',
    },
  };
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ ok: false, error: 'Method not allowed' }); return; }

  const body = (await readBody(req)) || {};

  // Melhor esforço: se o CRM antigo cair, o lead segue para a Lume do mesmo
  // jeito. Antes uma falha dele devolvia erro para a pessoa e o lead sumia.
  const antigo = (async () => {
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (process.env.FORM_WEBHOOK_SECRET) headers['X-Form-Secret'] = process.env.FORM_WEBHOOK_SECRET;
    try {
      const r = await fetch(CRM_ANTIGO, { method: 'POST', headers, body: JSON.stringify(body) });
      if (!r.ok) console.error('[lead] CRM antigo respondeu', r.status);
    } catch (e) { console.error('[lead] CRM antigo falhou:', String((e && e.message) || e)); }
  })();

  try {
    const r = await fetch(CRM_LUME, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(paraLume(body)),
    });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch (_) {}

    await antigo;

    // leadId é o id do card no CRM. A página manda ele pro Calendly (utm_content),
    // e é assim que o agendamento volta pra pessoa certa: o Calendly da Raquel
    // não pergunta WhatsApp.
    if (r.ok) { res.status(200).json({ ok: true, agente: !!(json && json.agente), leadId: (json && json.leadId) || '' }); return; }
    res.status(r.status >= 400 && r.status < 500 ? 400 : 502)
       .json({ ok: false, error: (json && json.error) || text.slice(0, 300) });
  } catch (e) {
    await antigo;
    res.status(502).json({ ok: false, error: String((e && e.message) || e) });
  }
};
