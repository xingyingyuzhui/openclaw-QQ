import test from "node:test";
import assert from "node:assert/strict";
import { arkShareGroup, arkSharePeer, clickInlineKeyboardButton, getAiCharacters, getAiRecord, getMiniAppArk, sendArkShare, sendFlashMessage, sendGroupAiRecord, sendGroupArkShare } from "../.test-dist/src/services/ai-ark-service.js";
function createClient(){const calls=[];return{calls,client:{async invokeNapCatAction(action,params,ctx){calls.push({action,params,ctx});return {ok:true};}}};}
test("ai ark service maps ai, ark and flash actions", async () => {
  const {calls,client}=createClient(); const ctx={route:"user:1",source:"chat",stage:"ai-ark"}; const p={foo:"bar"};
  for (const fn of [arkShareGroup,arkSharePeer,sendArkShare,sendGroupArkShare,getAiCharacters,getAiRecord,sendGroupAiRecord,getMiniAppArk,clickInlineKeyboardButton,sendFlashMessage]) await fn(client,p,ctx);
  assert.deepEqual(calls.map(it=>it.action),["ArkShareGroup","ArkSharePeer","send_ark_share","send_group_ark_share","get_ai_characters","get_ai_record","send_group_ai_record","get_mini_app_ark","click_inline_keyboard_button","send_flash_msg"]);
});
