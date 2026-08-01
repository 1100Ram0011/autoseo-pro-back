import axios from 'axios';

export const generateKeywordIdeas = async (seedKeyword: string) => {
  if (!seedKeyword || seedKeyword.trim() === '') {
    return { ideas: [] };
  }
  
  const baseKeyword = seedKeyword.toLowerCase().trim();
  const ideas = [];
  
  try {
    // 1. Fetch real autocomplete suggestions from Google
    const response = await axios.get(`http://suggestqueries.google.com/complete/search?client=chrome&q=${encodeURIComponent(baseKeyword)}`);
    const suggestions = response.data[1] || [];
    
    // 2. Add the base keyword first
    ideas.push({
      keyword: baseKeyword,
      searchVolume: Math.floor(Math.random() * 50000) + 5000, // Still mock volume because Google API requires paid Ads access for real volume
      competition: 'HIGH',
      cpcLow: (Math.random() * 2 + 0.5).toFixed(2),
      cpcHigh: (Math.random() * 10 + 3.0).toFixed(2)
    });
    
    // 3. Process the real autocomplete suggestions
    for (const suggestion of suggestions) {
      if (suggestion === baseKeyword) continue;
      
      const compVal = Math.random();
      const competition = compVal > 0.7 ? 'HIGH' : (compVal > 0.3 ? 'MEDIUM' : 'LOW');
      const vol = competition === 'HIGH' 
        ? Math.floor(Math.random() * 10000) + 1000
        : Math.floor(Math.random() * 1000) + 50;
        
      ideas.push({
        keyword: suggestion,
        searchVolume: vol,
        competition: competition,
        cpcLow: (Math.random() * 1.5 + 0.1).toFixed(2),
        cpcHigh: (Math.random() * 5 + 1.0).toFixed(2)
      });
    }
  } catch (error) {
    console.error('Failed to fetch from Google Autocomplete:', error);
  }
  
  // Sort by volume descending
  ideas.sort((a, b) => b.searchVolume - a.searchVolume);
  
  return { ideas };
};
