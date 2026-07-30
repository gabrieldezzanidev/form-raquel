// Serverless (Vercel) — recebe o formulário do navegador e encaminha ao CRM.
// Existe para que o segredo (FORM_WEBHOOK_SECRET) fique no servidor:
// se o navegador chamasse o CRM direto, o segredo ficaria visível no código da página.
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

const CRM_ENDPOINT = process.env.CRM_FORM_ENDPOINT
  || 'https://crm-raquel.vercel.app/api/public/form-submission';

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ ok: false, error: 'Method not allowed' }); return; }

  const body = (await readBody(req)) || {};

  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (process.env.FORM_WEBHOOK_SECRET) headers['X-Form-Secret'] = process.env.FORM_WEBHOOK_SECRET;

  try {
    const r = await fetch(CRM_ENDPOINT, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch (_) {}

    if (r.ok) { res.status(200).json(json || { ok: true }); return; }
    res.status(r.status >= 400 && r.status < 500 ? 400 : 502)
       .json({ ok: false, error: (json && json.error) || text.slice(0, 300) });
  } catch (e) {
    res.status(502).json({ ok: false, error: String((e && e.message) || e) });
  }
};
