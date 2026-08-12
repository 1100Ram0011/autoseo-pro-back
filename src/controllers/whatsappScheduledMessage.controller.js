import whatsappEngineApi
  from "../services/whatsappEngine.service.js";

  export const sendNow =
  async (
    req,
    res
  ) => {

    try {

      const accountId =
        req.user.id.toString();

      const response =
        await whatsappEngineApi.post(
          "/schedule/send-now",
          {
            accountId,
            ...req.body,
          }
        );

      return res.json(
        response.data
      );

    } catch (
      error
    ) {

      console.log(
        "SEND NOW ERROR:",
        error.response?.data ||
        error.message
      );

      return res.status(500).json({

        success: false,

        message:
          error.response?.data?.message ||
          "Failed to send message",
      });
    }
  };

  export const createSchedule =
  async (
    req,
    res
  ) => {

    try {

      const accountId =
        req.user.id.toString();

      const response =
        await whatsappEngineApi.post(
          "/scheduled-message/schedule",
          {
            accountId,
            ...req.body,
          }
        );

      return res.json(
        response.data
      );

    } catch (
      error
    ) {

      console.log(
        "CREATE SCHEDULE ERROR:",
        error.response?.data ||
        error.message
      );

      return res.status(500).json({

        success: false,

        message:
          error.response?.data?.message ||
          "Failed to create schedule",
      });
    }
  };


  export const getSchedules =
  async (
    req,
    res
  ) => {

    try {

      const accountId =
        req.user.id.toString();

      const response =
        await whatsappEngineApi.get(
          `/scheduled-message/schedule?accountId=${accountId}`
        );

      return res.json(
        response.data
      );

    } catch (
      error
    ) {

      return res.status(500).json({

        success: false,

        message:
          "Failed to fetch schedules",
      });
    }
  };

  export const getScheduleById =
  async (
    req,
    res
  ) => {

    try {

      const response =
        await whatsappEngineApi.get(
          `/scheduled-message/schedule/${req.params.scheduleId}`
        );

      return res.json(
        response.data
      );

    } catch (
      error
    ) {

      return res.status(500).json({

        success: false,

        message:
          "Failed to fetch schedule",
      });
    }
  };

  export const pauseSchedule =
  async (
    req,
    res
  ) => {

    const response =
      await whatsappEngineApi.post(
        `/scheduled-message/schedule/${req.params.scheduleId}/pause`
      );

    return res.json(
      response.data
    );
  };

export const resumeSchedule =
  async (
    req,
    res
  ) => {

    const response =
      await whatsappEngineApi.post(
        `/scheduled-message/schedule/${req.params.scheduleId}/resume`
      );

    return res.json(
      response.data
    );
  };

export const deleteSchedule =
  async (
    req,
    res
  ) => {

    const response =
      await whatsappEngineApi.delete(
        `/scheduled-message/schedule/${req.params.scheduleId}`
      );

    return res.json(
      response.data
    );
  };

export const runNowSchedule =
  async (
    req,
    res
  ) => {

    const response =
      await whatsappEngineApi.post(
        `/scheduled-message/schedule/${req.params.scheduleId}/run-now`
      );

    return res.json(
      response.data
    );
  };