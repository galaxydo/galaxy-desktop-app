async function BrainstormAgent() {
  const { text } = input;
  const { OpenAI } = await import("https://deno.land/x/openai@v4.16.1/mod.ts");
  const openAI = new OpenAI({ apiKey });

  const systemMessage = 'Brainstorm and propose innovative ideas for online platforms and digital infrastructures that could enhance global empowerment, adhering to the highest ethical standards to ensure a positive global impact.';

  let opts = { model: '', messages: [] };
  opts.model = 'gpt-4-1106-preview';
  opts.messages.push({ 'role': 'system', 'content': systemMessage });
  opts.messages.push({ 'role': 'user', 'content': text });
  const completion = await openAI.chat.completions.create(opts);

  return completion.choices[0].message.content;
}
