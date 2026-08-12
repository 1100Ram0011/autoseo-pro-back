import { GoogleAuth } from "google-auth-library";
import fetch from "node-fetch"; // Node <18
import config from "../config/config.js"

// async function callGemini() {
//     // 1️⃣ Auth (your existing code)
//     const auth = new GoogleAuth({
//         keyFile: config.KEY_FILE,
//         scopes: ["https://www.googleapis.com/auth/cloud-platform"],
//     });

//     const client = await auth.getClient();
//     const { token } = await client.getAccessToken();

//     // 2️⃣ Vertex Gemini endpoint
//     const PROJECT_ID = config.GOOGLE_PROJECT_ID;
//     const LOCATION = "global";
//     const MODEL_ID = "llama-4-maverick-17b-128e-instruct-maas";

//     const url = `https://aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/${MODEL_ID}:generateContent`;

//     // 3️⃣ Request body
//     const body = {
//         contents: [
//             {
//                 role: "user",
//                 parts: [{ text: "Say hello in one sentence" }],
//             },
//         ],
//     };

//     // 4️⃣ Call Vertex AI
//     const response = await fetch(url, {
//         method: "POST",
//         headers: {
//             Authorization: `Bearer ${token}`,
//             "Content-Type": "application/json",
//         },
//         body: JSON.stringify(body),
//     });

//     if (!response.ok) {
//         console.error(await response.text());
//         throw new Error("Vertex Gemini request failed");
//     }

//     const data = await response.json();

//     // 5️⃣ Extract text
//     const text =
//         data.candidates?.[0]?.content?.parts
//             ?.map(p => p.text)
//             .join("") || "";

//     console.log("Gemini response:");
//     console.log(text);
// }

// callGemini().catch(console.error);



// export async function callGemini(prompt, systemPrompt) {

//     const auth = new GoogleAuth({
//         keyFile: config.KEY_FILE,
//         scopes: ["https://www.googleapis.com/auth/cloud-platform"],
//     });

//     const client = await auth.getClient();
//     const { token } = await client.getAccessToken();

//     // const PROJECT_ID = config.GOOGLE_PROJECT_ID;
//     // const LOCATION = "us-central1";
//     const PROJECT_ID = config.GOOGLE_PROJECT_ID;
//     const LOCATION = "us-central1";;
//     const MODEL_ID = "gemini-3.1-pro-preview";

//     const url = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/${MODEL_ID}:streamGenerateContent`;

//     const body = {
//         contents: [
//             {
//                 role: "system",
//                 parts: [{ text: systemPrompt }]
//             },
//             {
//                 role: "user",
//                 parts: [{ text: prompt }]
//             }
//         ],
//         generationConfig: {
//             temperature: 0.2,
//             maxOutputTokens: 4096
//         }
//     };

//     const response = await fetch(url, {
//         method: "POST",
//         headers: {
//             Authorization: `Bearer ${token}`,
//             "Content-Type": "application/json",
//         },
//         body: JSON.stringify(body),
//     });

//     if (!response.ok) {
//         console.error(await response.text());
//         throw new Error("Vertex AI request failed");
//     }

//     const data = await response.json();

//     const text =
//         data.candidates?.[0]?.content?.parts
//             ?.map(p => p.text)
//             .join("") || "";

//     return text;
// }



async function callLlama() {
    const auth = new GoogleAuth({
        keyFile: config.KEY_FILE,
        scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    });

    const client = await auth.getClient();
    const { token } = await client.getAccessToken();

    const PROJECT_ID = config.GOOGLE_PROJECT_ID;
    const LOCATION = "us-east5"; // ✅ ONLY region
    const MODEL_ID = "llama-4-maverick-17b-128e-instruct-maas";

    const url = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/meta/models/${MODEL_ID}:generateContent`;

    const body = {
        contents: [
            {
                role: "user",
                parts: [{ text: "Say hello in one sentence" }],
            },
        ],
        generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 128,
        },
    };

    const response = await fetch(url, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        console.error(await response.text());
        throw new Error("Vertex LLaMA request failed");
    }

    const data = await response.json();

    const text =
        data.candidates?.[0]?.content?.parts
            ?.map(p => p.text)
            .join("") || "";

    console.log(text);
}

// callLlama().catch(console.error);


async function callVeo3() {
    // 1️⃣ Auth (same as Gemini)
    const auth = new GoogleAuth({
        keyFile: config.KEY_FILE,
        scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    });

    const client = await auth.getClient();
    const { token } = await client.getAccessToken();

    // 2️⃣ Vertex Veo endpoint
    const PROJECT_ID = config.GOOGLE_PROJECT_ID;
    const LOCATION = "us-central1";
    const MODEL_ID = "veo-3.0-generate-preview";

    const url = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/${LOCATION}/publishers/google/models/${MODEL_ID}:predictLongRunning`;

    // 3️⃣ Request body
    const body = {
        instances: [
            {
                prompt: "A cinematic drone shot over a futuristic city at sunset"
                // Optional reference image
                // image: {
                //   bytesBase64Encoded: fs.readFileSync("ref.png").toString("base64")
                // }
            }
        ]
    };

    // 4️⃣ Call Vertex AI
    const response = await fetch(url, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json; charset=utf-8",
        },
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        console.error(await response.text());
        throw new Error("Veo 3 request failed");
    }

    const operation = await response.json();
    console.log("Veo operation started:", operation.name);

    // 5️⃣ Poll long-running operation
    // await pollVeoOperation(operation.name, token, LOCATION);
}

// callVeo3().catch(console.error);

// callGemini("Say hello in one sentence", "You are a helpful assistant.").catch(console.error);



// import { GoogleGenAI } from "@google/genai";
// const ai = new GoogleGenAI({
//     apiKey: "AIzaSyCXLQpCcQ3BwzNSIdPBM4grR9zFKHwHDsA"
// });
// async function main() {
//     const response = await ai.models.generateContent({
//         model: "gemini-3-flash-preview",
//         contents: "Explain how AI works in a few words",
//     });
//     console.log(response.text);
// }
// await main();
