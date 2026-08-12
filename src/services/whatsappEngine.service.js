import axios from "axios";

const waApi =
  axios.create({
    baseURL:
      process.env
        .WHATSAPP_ENGINE_URL,

    headers: {
      "x-api-key":
        process.env
          .WHATSAPP_ENGINE_KEY,
    },

    timeout:
      60000,
  });

export default waApi;
