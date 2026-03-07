import test from "node:test";
import assert from "node:assert/strict";
import { deleteFriend, setDiyOnlineStatus, setOnlineStatus, setQqAvatar, setQqProfile, setSelfLongnick } from "../.test-dist/src/services/profile-status-service.js";
function createClient(){const calls=[];return{calls,client:{async invokeNapCatAction(action,params,ctx){calls.push({action,params,ctx});return {ok:true};}}};}
test("profile status service maps profile and status actions", async () => {
  const {calls,client}=createClient(); const ctx={route:"system",source:"chat",stage:"profile-status"}; const p={foo:"bar"};
  for (const fn of [deleteFriend,setDiyOnlineStatus,setOnlineStatus,setQqAvatar,setQqProfile,setSelfLongnick]) await fn(client,p,ctx);
  assert.deepEqual(calls.map(it=>it.action),["delete_friend","set_diy_online_status","set_online_status","set_qq_avatar","set_qq_profile","set_self_longnick"]);
});
