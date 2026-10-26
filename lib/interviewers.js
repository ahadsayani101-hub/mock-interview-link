// Server-side details for each interviewer persona (photos live in public/ui.js).
export const INTERVIEWERS = {
  maya: { name: "Maya", voice: "marin", style: "warm, upbeat and quick to smile" },
  daniel: { name: "Daniel", voice: "cedar", style: "calm, friendly and thoughtful" },
};
export const interviewer = (id) => INTERVIEWERS[id] || INTERVIEWERS.maya;
export const pickInterviewer = (id) => (INTERVIEWERS[id] ? id : Object.keys(INTERVIEWERS)[Math.floor(Math.random() * 2)]);
