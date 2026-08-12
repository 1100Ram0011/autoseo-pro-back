export const extractVariables = (html) => {
    const regex = /{{(.*?)}}/g;
    const matches = [...html.matchAll(regex)];
    return [...new Set(matches.map((m) => m[1].trim()))];
};
