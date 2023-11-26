async function aga() {
  const { text } = input;
  const requestBody = {
    prompt: text,
    history: [],
    tags: {
        "prompt": "user",
        "answer": "ai",
    },
    stop: ["</ai>"]
  };

  try {
    const response = await fetch('https://api.aga.live/prompt/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.log(errorData);
      throw new Error(errorData.message);
    }

    const data = await response.json();
    return data.text;
  } catch (error) {
    console.error('Error during prompt generation:', error);
    throw error;
  }
}
