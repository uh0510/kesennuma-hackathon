// Supabase Edge Function：伝票の写真から項目を読み取る（Claude API）
// 呼び出し：POST /functions/v1/ocr-slip  { imageBase64, mediaType }   mediaType 例 "image/jpeg"
// 秘密情報：ANTHROPIC_API_KEY, ANTHROPIC_MODEL（画像入力に対応したモデルIDを設定）
// 読み取り結果はそのまま登録せず、画面で人が確認してから record-event に渡す

const PROMPT = `これは気仙沼の魚市場の伝票の写真です。次の項目を読み取り、JSONだけを返してください。
読めない項目は null にしてください。推測で埋めないでください。
{"ship_name": "", "species": "", "grade": "", "quantity": "", "weight_kg": 0, "buyer_no": "", "buyer_name": "", "landed_date": "YYYY-MM-DD", "catch_area": ""}`

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const { imageBase64, mediaType = 'image/jpeg' } = await req.json()
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': Deno.env.get('ANTHROPIC_API_KEY')!,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: Deno.env.get('ANTHROPIC_MODEL'),
      max_tokens: 1024,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
        { type: 'text', text: PROMPT },
      ] }],
    }),
  })
  const data = await res.json()
  const text = data?.content?.find((c: { type: string }) => c.type === 'text')?.text ?? '{}'
  const json = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)
  try {
    return Response.json({ ok: true, fields: JSON.parse(json) }, { headers: CORS })
  } catch {
    return Response.json({ ok: false, raw: text }, { status: 422, headers: CORS })
  }
})
