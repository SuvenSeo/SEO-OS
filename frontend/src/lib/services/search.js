import axios from 'axios';

export async function searchWeb(query) {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    console.warn('[Search] TAVILY_API_KEY missing.');
    return 'Search unavailable (missing API key).';
  }

  try {
    const response = await axios.post('https://api.tavily.com/search', {
      api_key: apiKey,
      query,
      search_depth: 'advanced',
      include_answer: true,
      max_results: 5,
    });

    const results = response.data.results;
    if (!results || results.length === 0) return 'No results found.';

    const formatted = results
      .map((r, i) => `[${i + 1}] ${r.title}\nSource: ${r.url}\nContent: ${r.content}`)
      .join('\n\n---\n\n');

    const answer = response.data.answer ? `QUICK ANSWER: ${response.data.answer}\n\n` : '';
    
    return `${answer}DETAILED RESULTS:\n${formatted}`;
  } catch (error) {
    console.error('[Search] Error:', error.response?.data || error.message);
    return `Error performing search: ${error.message}`;
  }
}
