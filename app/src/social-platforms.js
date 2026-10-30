// Publishing rules per network, shared by the AI service (prompt + limits) and the studio UI (labels + counters).
// text = maximum length of the final post (caption, chapters and hashtags together); hashtags = [min,max].
export const SOCIAL_PLATFORMS={
 youtube:{label:'YouTube',title:100,text:5000,hashtags:[3,5],keywords:15,chapters:true,
  guide:'YouTube is a search engine. Title: searchable, main keyword in the first 60 characters, a clear promise the video really keeps, no clickbait, no all caps. Description: the first two lines (about 150 characters) hook the viewer and repeat the main keyword because only they show before "more"; then a short summary of what the viewer learns; then a call to subscribe or comment. Hashtags: 3 to 5 relevant ones (the first three appear above the title). Keywords: 8 to 15 search tags from broad to specific. Chapters: first at 0 seconds, at least 10 seconds apart, short descriptive titles.'},
 tiktok:{label:'TikTok',title:0,text:2200,hashtags:[3,5],
  guide:'TikTok rewards watch time and a native, casual tone. Caption: short (ideally under 150 characters), opens with a curiosity hook or a question, talks like a creator to a friend, one or two emojis at most, ends with a light invitation to comment or follow. Hashtags: 3 to 5, one broad topic tag plus niche community tags; never generic spam such as #fyp or #viral. Hook: punchy on-screen text for the first second, 8 words maximum.'},
 instagram:{label:'Instagram Reels',title:0,text:2200,hashtags:[3,5],
  guide:'Instagram favours saves and shares. Only the first 125 characters show before "more": open with a strong hook. Short lines separated by line breaks, one concrete takeaway, end with a call to save, share or comment. Few emojis. Hashtags: 3 to 5 specific and relevant ones rather than many generic ones. Hook: cover text for the reel, 8 words maximum.'},
 linkedin:{label:'LinkedIn',title:0,text:3000,hashtags:[3,5],
  guide:'LinkedIn is professional and value-driven. The first 210 characters show before "see more": open with an insight, a result or a counter-intuitive statement, never with "I am happy to share". Paragraphs of one or two sentences separated by blank lines, a personal lesson or practical takeaways (a short list is fine), no external link in the body, minimal emojis, end with an open question that invites informed comments. Hashtags: 3 to 5 professional topic tags.'},
 x:{label:'X (Twitter)',title:0,text:280,hashtags:[0,2],
  guide:'X is fast and conversational. One punchy post that fits in 280 characters including hashtags: a strong opinion, a key quote from the video or a surprising fact, plain words, no filler. At most 1 or 2 hashtags, only when natural.'},
 facebook:{label:'Facebook',title:0,text:5000,hashtags:[0,3],
  guide:'Facebook favours conversations between people. Warm, friendly tone; short post (1 to 3 sentences) saying what the video brings, ending with a simple question to start the comments. 0 to 3 hashtags.'}
};
export const DEFAULT_SOCIAL_PLATFORMS=['youtube','tiktok','instagram','linkedin'];
