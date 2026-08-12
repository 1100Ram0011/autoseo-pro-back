import axios from "axios";

export async function verifyEmailWithNeverBounce(email) {
  try {
    const apiKey = process.env.NEVERBOUNCE_API_KEY;

    const { data } = await axios.get(
      "https://api.neverbounce.com/v4/single/check",
      {
        params: { key: apiKey, email },
        timeout: 8000,
      }
    );

    /**
     * data.result can be:
     * valid | invalid | disposable | catchall | unknown
     */
    return {
      ok: data?.result === "valid",
      status: data?.result,         // keep same field name you were using
      subStatus: data?.flags || {}, // optional metadata
      raw: data,
    };
  } catch (err) {
    return {
      ok: false,
      status: "error",
      error: err?.response?.data || err?.message,
    };
  }
}