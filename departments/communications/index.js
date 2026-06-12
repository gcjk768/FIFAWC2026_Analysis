'use strict';

/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║    WC2026 ANALYTICS CORP — COMMUNICATIONS DEPARTMENT        ║
 * ║                                                              ║
 * ║  Director: All external communications and media relations   ║
 * ║                                                              ║
 * ║  Staff:                                                      ║
 * ║  • Telegram Desk   (telegram-mcp)   — Channel publishing    ║
 * ║  • Press Office    (alertService)   — Broadcast alerts      ║
 * ║  • Editorial Desk  (scheduler)      — Daily digest          ║
 * ║  • News Desk       (newsService)    — Media monitoring      ║
 * ║  • Customer Service (chatbot.js)    — Fan Q&A via Telegram  ║
 * ║  • Intent Router   (intentService) — Message classification ║
 * ║  • Chat Service    (chatService)   — Ollama queue + history  ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * This department handles ALL outbound communications:
 *   - Telegram channel broadcasts (match alerts, predictions, results)
 *   - Daily digests with predictions and news
 *   - Breaking news (FIFA news + team updates)
 *   - Fan chatbot interactions (bilingual EN/ZH)
 *   - Pre-match previews (3-day and 1-day)
 *
 * Usage:
 *   const comms = require('./departments/communications');
 *   await comms.broadcastAnalysis(prediction);
 *   await comms.sendDailyDigest(matches);
 *   const reply = await comms.handleFanQuery(message, chatId);
 */

// Staff — imported from their service files (not yet physically moved)
const intentService = require('../../services/intentService');
const chatService   = require('../../services/chatService');
const alertService  = require('../../services/alertService');
const newsService   = require('../../services/newsService');

/**
 * Route and handle an incoming fan message via Telegram.
 * Classifies intent, dispatches to the correct handler, returns reply text.
 *
 * @param {object} msg - Telegram message object
 * @param {number} chatId - Telegram chat/user ID
 * @returns {Promise<string>}
 */
async function handleFanQuery(msg, chatId) {
  console.log(`[COMMS] 📨 Incoming fan query from chat ${chatId}`);
  return intentService.classifyAndHandle(msg, chatId);
}

/**
 * Check if an alert has already been sent to prevent duplicates.
 * @param {string} alertId
 * @returns {boolean}
 */
function isAlertSent(alertId) {
  return alertService.isAlertSent(alertId);
}

module.exports = {
  // Department-level API
  handleFanQuery,
  isAlertSent,
  // Direct service exports (for consumers that import by feature)
  ...intentService,
  ...chatService,
  // Individual alert service functions
  isAlertSent:   alertService.isAlertSent,
  markAlertSent: alertService.markAlertSent,
  sendToChannel: alertService.sendToChannel,
  // News desk
  fetchTopNews:        newsService.fetchTopNews,
  writeNewsToObsidian: newsService.writeNewsToObsidian,
};
