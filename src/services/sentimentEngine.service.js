import { createRequire } from "module";
const require = createRequire(import.meta.url);
const vader = require("vader-sentiment");

/**
 * Analyzes text using the VADER sentiment engine.
 * @param {string} text - The input text to analyze.
 * @returns {object} The analysis result:
 *   - label: 'positive' | 'neutral' | 'negative'
 *   - score: compound score (-1 to 1)
 *   - confidence: mapped confidence score (0 to 1)
 *   - positiveSignals: Array of words triggering positive sentiment
 *   - negativeSignals: Array of words triggering negative sentiment
 *   - metrics: { neg, neu, pos, compound }
 */
export function analyzeTextWithVader(text = "") {
  if (!text || !String(text).trim()) {
    return {
      label: "neutral",
      score: 0,
      confidence: 0.5,
      positiveSignals: [],
      negativeSignals: [],
      metrics: { neg: 0, neu: 1, pos: 0, compound: 0 }
    };
  }

  // Calculate scores using VADER's static method
  const scores = vader.SentimentIntensityAnalyzer.polarity_scores(text);
  const compound = scores.compound;

  // Determine sentiment label based on standard VADER thresholds:
  // Positive: compound >= 0.05
  // Negative: compound <= -0.05
  // Neutral: -0.05 < compound < 0.05
  let label = "neutral";
  if (compound >= 0.05) {
    label = "positive";
  } else if (compound <= -0.05) {
    label = "negative";
  }

  // Parse words for positive and negative sentiment signals dynamically using VADER
  const words = String(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  const positiveSignals = [];
  const negativeSignals = [];

  for (const word of words) {
    const wordScore = vader.SentimentIntensityAnalyzer.polarity_scores(word).compound;
    if (wordScore > 0.05 && !positiveSignals.includes(word)) {
      positiveSignals.push(word);
    }
    if (wordScore < -0.05 && !negativeSignals.includes(word)) {
      negativeSignals.push(word);
    }
  }

  // Calculate a reliable confidence score (mapped between 0.35 and 0.95 based on intensity & word count)
  const signalCount = positiveSignals.length + negativeSignals.length;
  const rawConfidence = Math.max(0.35, Math.abs(compound));
  const confidence = Number(Math.min(0.95, rawConfidence + (signalCount * 0.02)).toFixed(2));
  
 

  return {
    label,
    score: Number(compound.toFixed(2)),
    confidence,
    positiveSignals,
    negativeSignals,
    metrics: {
      neg: Number(scores.neg.toFixed(3)),
      neu: Number(scores.neu.toFixed(3)),
      pos: Number(scores.pos.toFixed(3)),
      compound: Number(scores.compound.toFixed(4))
    }
  };
}
