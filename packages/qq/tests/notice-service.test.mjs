import test from "node:test";
import assert from "node:assert/strict";
import {
  deleteGroupNotice,
  getGroupDetailInfo,
  getGroupIgnoreAddRequest,
  getGroupIgnoredNotifies,
  getGroupInfoEx,
  getGroupNotice,
  getGroupShutList,
  sendGroupNotice,
  setGroupAddOption,
  setGroupKickMembers,
  setGroupRobotAddOption,
  setGroupSearch,
  setGroupTodo,
} from "../.test-dist/src/services/notice-service.js";

function createClient(){const calls=[];return{calls,client:{async invokeNapCatAction(action,params,ctx){calls.push({action,params,ctx});return {ok:true};}}};}
test("notice service maps notice and extended group management actions", async () => {
  const {calls,client}=createClient(); const ctx={route:"group:42",source:"chat",stage:"notice"}; const params={group_id:42,id:"x"};
  for (const fn of [getGroupNotice,sendGroupNotice,deleteGroupNotice,getGroupIgnoreAddRequest,getGroupIgnoredNotifies,getGroupDetailInfo,getGroupInfoEx,getGroupShutList,setGroupAddOption,setGroupRobotAddOption,setGroupSearch,setGroupTodo,setGroupKickMembers]) await fn(client,params,ctx);
  assert.deepEqual(calls.map(it=>it.action),["_get_group_notice","_send_group_notice","_del_group_notice","get_group_ignore_add_request","get_group_ignored_notifies","get_group_detail_info","get_group_info_ex","get_group_shut_list","set_group_add_option","set_group_robot_add_option","set_group_search","set_group_todo","set_group_kick_members"]);
});
