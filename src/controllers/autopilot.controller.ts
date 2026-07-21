import { Request, Response } from 'express';

export const runAutoPilotStream = (req: Request, res: Response) => {
  const { workflowId } = req.query;

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*'); // Or strict origin for prod

  // Send an initial connected event
  res.write(`data: ${JSON.stringify({ msg: 'Connected to Auto-Pilot Engine', done: true })}\n\n`);

  let steps: string[] = [];

  if (workflowId === 'audit') {
    steps = ['Initializing crawl engine...', 'Scanning internal links...', 'Analyzing Core Web Vitals...', 'Checking meta descriptions...', 'Generating AI Audit Report...'];
  } else if (workflowId === 'content') {
    steps = ['Analyzing search trends...', 'Identifying content gaps...', 'Drafting NLP-optimized blog post...', 'Generating meta title and description...', 'Scheduling webhook for publishing...'];
  } else {
    // Default to agentic setup
    steps = ['Scanning site architecture...', 'Generating agent-card.json...', 'Building OpenAPI schemas...', 'Publishing AI Identity to .well-known...'];
  }

  let currentStep = 0;

  const intervalId = setInterval(() => {
    if (currentStep < steps.length) {
      // Send the current step as "in progress"
      res.write(`data: ${JSON.stringify({ msg: steps[currentStep], done: false })}\n\n`);

      // Immediately after, simulate it being done in the next tick (next 1.5s)
      // Actually, we can just let the frontend mark the previous one done when a new one arrives.
      currentStep++;
    } else {
      // Send a completion signal
      res.write(`data: ${JSON.stringify({ msg: 'COMPLETE', done: true })}\n\n`);
      clearInterval(intervalId);
      res.end();
    }
  }, 2000);

  // If client closes connection
  req.on('close', () => {
    clearInterval(intervalId);
  });
};
