import whatsappEngineApi
  from "../services/whatsappEngine.service.js";

/*
|--------------------------------------------------------------------------
| GET CHATS
|--------------------------------------------------------------------------
*/

export const getChats =
  async (
    req,
    res
  ) => {

    try {

      const {
        connectionId,
      } = req.params;

      const response =
        await whatsappEngineApi.get(
          `/inbox/chats/${connectionId}`
        );

      return res.json(
        response.data
      );

    } catch (
      error
    ) {

      console.log(
        "GET CHATS ERROR:",
        error.response?.data ||
        error.message
      );

      return res.status(500).json({

        success: false,

        message:
          "Failed to fetch chats",
      });
    }
  };

/*
|--------------------------------------------------------------------------
| GET CHAT MESSAGES
|--------------------------------------------------------------------------
*/

export const getChatMessages =
  async (
    req,
    res
  ) => {

    try {

      const {
        connectionId,
        chatId,
      } = req.params;

      const response =
        await whatsappEngineApi.get(
          `/groups/chats/${connectionId}/${encodeURIComponent(chatId)}`
        );

      return res.json(
        response.data
      );

    } catch (
      error
    ) {

      console.log(
        "GET CHAT MESSAGES ERROR:",
        error.response?.data ||
        error.message
      );

      return res.status(500).json({

        success: false,

        message:
          "Failed to fetch messages",
      });
    }
  };

/*
|--------------------------------------------------------------------------
| GET GROUPS
|--------------------------------------------------------------------------
*/

export const getGroups =
  async (
    req,
    res
  ) => {

    try {

      const {
        connectionId,
      } = req.params;

      const response =
        await whatsappEngineApi.get(
          `/groups/groups/${connectionId}`
        );

      return res.json(
        response.data
      );

    } catch (
      error
    ) {

      console.log(
        "GET GROUPS ERROR:",
        error.response?.data ||
        error.message
      );

      return res.status(500).json({

        success: false,

        message:
          "Failed to fetch groups",
      });
    }
  };

/*
|--------------------------------------------------------------------------
| GET GROUP DETAILS
|--------------------------------------------------------------------------
*/

export const getGroupDetails =
  async (
    req,
    res
  ) => {

    try {

      const {
        connectionId,
        groupId,
      } = req.params;

      const response =
        await whatsappEngineApi.get(
          `/groups/groups/${connectionId}/${encodeURIComponent(groupId)}`
        );

      return res.json(
        response.data
      );

    } catch (
      error
    ) {

      console.log(
        "GET GROUP DETAILS ERROR:",
        error.response?.data ||
        error.message
      );

      return res.status(500).json({

        success: false,

        message:
          "Failed to fetch group details",
      });
    }
  };

/*
|--------------------------------------------------------------------------
| GET GROUP MEMBERS
|--------------------------------------------------------------------------
*/

export const getGroupMembers =
  async (
    req,
    res
  ) => {

    try {

      const {
        connectionId,
        groupId,
      } = req.params;

      const response =
        await whatsappEngineApi.get(
          `/groups/groups/${connectionId}/${encodeURIComponent(groupId)}/members`
        );

      return res.json(
        response.data
      );

    } catch (
      error
    ) {

      console.log(
        "GET GROUP MEMBERS ERROR:",
        error.response?.data ||
        error.message
      );

      return res.status(500).json({

        success: false,

        message:
          "Failed to fetch group members",
      });
    }
  };