import test from "node:test";
import assert from "node:assert/strict";
import { botExit, checkUrlSafely, cleanCache, getClientKey, getModelShow, getPacketStatus, getRKey, getRKeyServer, getRobotUinRange, getUserStatus, invokeUnknownAction, markAllAsRead, setModelShow, setRestart, testDownloadStream, translateEn2Zh } from "../.test-dist/src/services/system-admin-service.js";
function createClient(){const calls=[];return{calls,client:{async invokeNapCatAction(action,params,ctx){calls.push({action,params,ctx});return {ok:true};}}};}
test("system admin service maps system and diagnostic actions", async () => {
  const {calls,client}=createClient(); const ctx={route:"system",source:"chat",stage:"system"}; const p={foo:"bar"};
  for (const fn of [getModelShow,setModelShow,markAllAsRead,botExit,cleanCache,checkUrlSafely,getClientKey,getRobotUinRange,getRKey,getRKeyServer,getPacketStatus,getUserStatus,setRestart,testDownloadStream,translateEn2Zh,invokeUnknownAction]) await fn(client,p,ctx);
  assert.deepEqual(calls.map(it=>it.action),["_get_model_show","_set_model_show","_mark_all_as_read","bot_exit","clean_cache","check_url_safely","get_clientkey","get_robot_uin_range","get_rkey","get_rkey_server","nc_get_packet_status","nc_get_user_status","set_restart","test_download_stream","translate_en2zh","unknown"]);
});
