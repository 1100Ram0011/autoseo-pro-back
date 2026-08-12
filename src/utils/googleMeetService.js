import { google } from 'googleapis';
import { JWT } from 'google-auth-library';
import logger from '../config/logger.js';

// Google Meet configuration using environment variables
const GOOGLE_MEET_CONFIG = {
  SCOPES: [
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/meetings.space.created',
    'https://www.googleapis.com/auth/meetings.space.readonly'
  ],
  // Get credentials from environment variables
  CREDENTIALS: {
    type: 'service_account',
    project_id: process.env.GOOGLE_MEET_PROJECT_ID,
    private_key_id: process.env.GOOGLE_MEET_PRIVATE_KEY_ID,
    private_key: process.env.GOOGLE_MEET_PRIVATE_KEY?.replace(/\\n/g, '\n'), // Handle escaped newlines
    client_email: process.env.GOOGLE_MEET_CLIENT_EMAIL,
    client_id: process.env.GOOGLE_MEET_CLIENT_ID,
    auth_uri: 'https://accounts.google.com/o/oauth2/auth',
    token_uri: 'https://oauth2.googleapis.com/token',
    auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs',
    client_x509_cert_url: `https://www.googleapis.com/robot/v1/metadata/x509/${process.env.GOOGLE_MEET_CLIENT_EMAIL}`
  },
  CALENDAR_ID: process.env.GOOGLE_MEET_CALENDAR_ID || 'primary',
  ADMIN_EMAIL: process.env.GOOGLE_MEET_ADMIN_EMAIL
};

// Validate required environment variables
const validateConfig = () => {
  const required = [
    'GOOGLE_MEET_PROJECT_ID',
    'GOOGLE_MEET_PRIVATE_KEY_ID',
    'GOOGLE_MEET_PRIVATE_KEY',
    'GOOGLE_MEET_CLIENT_EMAIL',
    'GOOGLE_MEET_CLIENT_ID'
  ];

  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    throw new Error(`Missing required Google Meet environment variables: ${missing.join(', ')}`);
  }
};

// Initialize Google Meet API
let calendar = null;
let auth = null;

const initializeGoogleMeet = async () => {
  try {
    // Validate environment variables
    validateConfig();

    // Create JWT client with environment variables
    auth = new JWT({
      email: GOOGLE_MEET_CONFIG.CREDENTIALS.client_email,
      key: GOOGLE_MEET_CONFIG.CREDENTIALS.private_key,
      scopes: GOOGLE_MEET_CONFIG.SCOPES,
      subject: GOOGLE_MEET_CONFIG.ADMIN_EMAIL || GOOGLE_MEET_CONFIG.CREDENTIALS.client_email
    });

    // Initialize Calendar API
    calendar = google.calendar({ version: 'v3', auth });
    
    logger.info('Google Meet service initialized successfully with environment variables');
    return true;
  } catch (error) {
    logger.error('Failed to initialize Google Meet service:', error);
    throw error;
  }
};

// Convert date and time slot to ISO string
const convertToDateTime = (date, timeSlot) => {
  const [time, modifier] = timeSlot.split(' ');
  let [hours, minutes] = time.split(':').map(Number);
  
  if (modifier === 'PM' && hours !== 12) hours += 12;
  if (modifier === 'AM' && hours === 12) hours = 0;
  
  const meetingDateTime = new Date(`${date}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`);
  
  return {
    start: meetingDateTime.toISOString(),
    end: new Date(meetingDateTime.getTime() + 60 * 60 * 1000).toISOString() // Add 1 hour
  };
};

// Create Google Meet link
export const createGoogleMeetLink = async (attendeeEmail, subject, date, timeSlot) => {
  try {
    // Initialize if not already done
    if (!calendar) {
      await initializeGoogleMeet();
    }

    const { start, end } = convertToDateTime(date, timeSlot);

    // Create calendar event with Google Meet
    const event = {
      summary: subject,
      description: 'Meeting scheduled via BoradeAI platform',
      start: {
        dateTime: start,
        timeZone: 'Asia/Kolkata'
      },
      end: {
        dateTime: end,
        timeZone: 'Asia/Kolkata'
      },
      conferenceData: {
        createRequest: {
          requestId: `boradeai-${Date.now()}`,
          conferenceSolutionKey: 'hangoutsMeet'
        }
      },
      attendees: [
        { email: attendeeEmail }
      ],
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'email', minutes: 60 }, // 1 hour before
          { method: 'popup', minutes: 15 } // 15 minutes before
        ]
      }
    };

    const response = await calendar.events.insert({
      calendarId: GOOGLE_MEET_CONFIG.CALENDAR_ID,
      resource: event,
      conferenceDataVersion: 1
    });

    const eventData = response.data;
    const meetLink = eventData.hangoutLink || eventData.conferenceData?.entryPoints?.[0]?.uri;

    logger.info(`Google Meet created successfully: ${meetLink}`);
    
    return {
      success: true,
      meetLink,
      eventId: eventData.id,
      htmlLink: eventData.htmlLink
    };

  } catch (error) {
    logger.error('Failed to create Google Meet link:', error);
    
    // Fallback: Generate a generic Google Meet URL
    const fallbackLink = `https://meet.google.com/lookup/boradeai-${Date.now()}`;
    
    return {
      success: false,
      error: error.message,
      meetLink: fallbackLink,
      fallback: true
    };
  }
};

// Update calendar event (if needed)
export const updateGoogleMeetEvent = async (eventId, updates) => {
  try {
    if (!calendar) {
      await initializeGoogleMeet();
    }

    const response = await calendar.events.patch({
      calendarId: GOOGLE_MEET_CONFIG.CALENDAR_ID,
      eventId: eventId,
      resource: updates
    });

    return {
      success: true,
      event: response.data
    };
  } catch (error) {
    logger.error('Failed to update Google Meet event:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

// Delete calendar event (if needed)
export const deleteGoogleMeetEvent = async (eventId) => {
  try {
    if (!calendar) {
      await initializeGoogleMeet();
    }

    await calendar.events.delete({
      calendarId: GOOGLE_MEET_CONFIG.CALENDAR_ID,
      eventId: eventId
    });

    logger.info(`Google Meet event deleted: ${eventId}`);
    return { success: true };
  } catch (error) {
    logger.error('Failed to delete Google Meet event:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

// Get calendar events for a date range
export const getCalendarEvents = async (startDate, endDate) => {
  try {
    if (!calendar) {
      await initializeGoogleMeet();
    }

    const response = await calendar.events.list({
      calendarId: GOOGLE_MEET_CONFIG.CALENDAR_ID,
      timeMin: startDate,
      timeMax: endDate,
      singleEvents: true,
      orderBy: 'startTime'
    });

    return {
      success: true,
      events: response.data.items
    };
  } catch (error) {
    logger.error('Failed to get calendar events:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

export default {
  createGoogleMeetLink,
  updateGoogleMeetEvent,
  deleteGoogleMeetEvent,
  getCalendarEvents,
  initializeGoogleMeet
};
