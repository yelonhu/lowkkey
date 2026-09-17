const strings: Record<string, [string, string, string]> = {
"rowNumber": ["Set","组","組"],
"rowOptions": ["Set options","组详情","組詳情"],
"repsShort": ["Reps","次数","次數"],
"done": ["Done","完成","完成"],
"rowIncomplete": ["Finish the load and reps to record this row.","填好重量和次数后记录这一行。","填好重量和次數後記錄這一行。"],
"reviewRow": ["Saved: {{current}}. Your edit: {{proposed}}.","当前记录：{{current}}。你的修改：{{proposed}}。","目前紀錄：{{current}}。你的修改：{{proposed}}。"],
"applyEdit": ["Apply my edit","应用我的修改","套用我的修改"],
"addSet": ["Add set","加一组","加一組"],
"barIncluded": ["Bar included","含杆","含槓"],
"loadStep": ["Load step","重量档位","重量檔位"],
"addLoad": ["Add","添加","新增"],
"defaultSource": ["Defaults from {{version}}. Changes stay with this configuration.","默认来源：{{version}}，修改保留在此配置。","預設來源：{{version}}，修改保留在此設定。"],
"applySetup": ["Apply configuration","应用配置","套用設定"],
"sessionOptions": ["Workout options","训练选项","訓練選項"],
"minutes": ["min","分钟","分鐘"],
"short_external_total": ["Total","总重","總重"],
"short_per_side": ["Per side","单侧","單側"],
"short_assistance": ["Assistance","助力","助力"],
"short_added_weight": ["Added load","额外负重","額外負重"],
"short_bodyweight_only": ["Bodyweight","自重","自重"],
"short_unspecified": ["Load","负重","負重"],
  deleteCompleted: ['A completed workout must keep at least one set. To remove all sets, use Delete this workout above.', '已结束的训练至少保留一组；如需全部移除，请使用上方“删除这次记录”。', '已結束的訓練至少保留一組；如需全部移除，請使用上方「刪除此訓練紀錄」。'],
  configurationOptions: ['More details', '更多详情', '更多詳情'],
  increment: ['Increment (optional)', '最小增量（选填）', '最小增量（選填）'],
  available: ['Available loads', '可用档位', '可用檔位'],
  fixedUnits: ['These units stay with the increments when the display unit changes.', '切换显示单位不会改变这些增量和档位的原单位。', '切換顯示單位不會改變這些增量和檔位的原單位。'],
  "title": [
    "Training",
    "训练",
    "訓練"
  ],
  "subtitle": [
    "Record the sets you actually complete.",
    "记录实际完成的每一组。",
    "記錄實際完成的每一組。"
  ],
  "start": [
    "Start empty workout",
    "开始空白训练",
    "開始空白訓練"
  ],
  "resumeSession": [
    "Open workout",
    "打开训练",
    "開啟訓練"
  ],
  "name": [
    "Workout name (optional)",
    "训练名称（选填）",
    "訓練名稱（選填）"
  ],
  "noSessions": [
    "No workouts recorded yet.",
    "还没有训练记录。",
    "尚無訓練紀錄。"
  ],
  "recent": [
    "Recent workouts",
    "最近训练",
    "最近訓練"
  ],
  "addExercise": [
    "Add exercise",
    "添加动作",
    "新增動作"
  ],
  "chooseExercise": [
    "Exercise",
    "动作",
    "動作"
  ],
  "choose": [
    "Choose an exercise",
    "请选择动作",
    "請選擇動作"
  ],
  "search": [
    "Search exercises",
    "搜索动作",
    "搜尋動作"
  ],
  "custom": [
    "Create personal exercise",
    "创建个人动作",
    "建立個人動作"
  ],
  "customName": [
    "Personal exercise name",
    "个人动作名称",
    "個人動作名稱"
  ],
  "equipment": [
    "Equipment type",
    "器械类型",
    "器械類型"
  ],
  "angle": [
    "Angle",
    "角度",
    "角度"
  ],
  "grip": [
    "Grip",
    "抓握",
    "握法"
  ],
  "laterality": [
    "Execution",
    "执行侧",
    "執行側"
  ],
  "configuration": [
    "Equipment configuration",
    "器械配置",
    "器械設定"
  ],
  "newSetup": [
    "New configuration",
    "新建配置",
    "新增設定"
  ],
  "instance": [
    "Equipment name / location (optional)",
    "器械名称／位置（选填）",
    "器械名稱／位置（選填）"
  ],
  "unspecifiedEquipment": [
    "Equipment not specified; no cross-equipment PR.",
    "器械未指定，不进行跨器械 PR 比较。",
    "器械未指定，不進行跨器械 PR 比較。"
  ],
  "semantics": [
    "What this load means",
    "重量含义",
    "重量含義"
  ],
  "unit": [
    "Load unit",
    "重量单位",
    "重量單位"
  ],
  "includesBar": [
    "Does this number already include the bar?",
    "这个数字是否已经含杆？",
    "這個數字是否已經含槓？"
  ],
  "yes": [
    "Yes, includes bar",
    "是，已经含杆",
    "是，已經含槓"
  ],
  "no": [
    "No",
    "否",
    "否"
  ],
  "unknown": [
    "Not specified",
    "未指定",
    "未指定"
  ],
  "barWeight": [
    "Bar weight (optional)",
    "杆重（选填）",
    "槓重（選填）"
  ],
  "barRule": [
    "Included bar weight is never added again.",
    "已经含杆的数值不会再加一次杆重。",
    "已含槓的數值不會再加一次槓重。"
  ],
  "perSideRule": [
    "Enter one side only. It will not be doubled.",
    "按每只／每侧填写，不会乘二。",
    "按每隻／每側填寫，不會乘二。"
  ],
  "add": [
    "Use this configuration",
    "使用此配置",
    "使用此設定"
  ],
  "noCatalog": [
    "You can create a personal exercise while the standard catalog is being reviewed.",
    "标准目录审核期间，可以创建个人动作。",
    "標準目錄審核期間，可以建立個人動作。"
  ],
  "sets": [
    "Recorded sets",
    "已记录组",
    "已記錄組"
  ],
  "setNumber": [
    "Set {{number}}",
    "第 {{number}} 组",
    "第 {{number}} 組"
  ],
  "newSet": [
    "Record a set",
    "记录一组",
    "記錄一組"
  ],
  "editSet": [
    "Edit set",
    "修改组",
    "修改組"
  ],
  "load": [
    "Load",
    "重量",
    "重量"
  ],
  "reps": [
    "Repetitions",
    "次数",
    "次數"
  ],
  "rpe": [
    "RPE (optional, 0.5 steps)",
    "RPE（选填，步长 0.5）",
    "RPE（選填，間隔 0.5）"
  ],
  "setType": [
    "Set type",
    "组类型",
    "組類型"
  ],
  "note": [
    "Note (optional)",
    "备注（选填）",
    "備註（選填）"
  ],
  "noSets": [
    "No completed sets yet.",
    "尚未记录实际组。",
    "尚未記錄實際組。"
  ],
  "saveSet": [
    "Save set",
    "保存这组",
    "儲存這組"
  ],
  "edit": [
    "Edit",
    "修改",
    "修改"
  ],
  "remove": [
    "Delete",
    "删除",
    "刪除"
  ],
  "confirmDeleteSet": [
    "Delete this set?",
    "删除这一组？",
    "刪除這一組？"
  ],
  "confirmDeleteExercise": [
    "Delete this exercise and its recorded sets?",
    "删除这个动作及其已记录组？",
    "刪除此動作及其已記錄組？"
  ],
  "deleteImpact": [
    "Only the selected record is deleted after confirmation. Other exercises remain.",
    "确认后仅删除选中的记录，其他动作保留。",
    "確認後只刪除選中的紀錄，其他動作保留。"
  ],
  "pause": [
    "Pause",
    "暂停",
    "暫停"
  ],
  "resume": [
    "Continue",
    "继续",
    "繼續"
  ],
  "finish": [
    "Finish workout",
    "结束训练",
    "結束訓練"
  ],
  "cancelWorkout": [
    "Cancel workout",
    "取消训练",
    "取消訓練"
  ],
  "finishTitle": [
    "Finish the recorded part?",
    "结束已记录的部分？",
    "結束已記錄的部分？"
  ],
  "finishDescription": [
    "Only recorded sets count. Ending does not claim that all planned sets were completed.",
    "只统计已记录组。结束不代表完成了全部计划组。",
    "只統計已記錄組。結束不代表完成全部計畫組。"
  ],
  "halfDraft": [
    "There is unfinished input. You can return to edit it, or finish the recorded part and keep the draft.",
    "还有半填内容。可以返回完善，或仅结束已记录部分并保留草稿。",
    "還有未填完的內容。可以返回補齊，或只結束已記錄部分並保留草稿。"
  ],
  "keepAndFinish": [
    "Keep sets and finish",
    "保留已做部分并结束",
    "保留已做部分並結束"
  ],
  "deleteWorkout": [
    "Delete this workout",
    "删除这次记录",
    "刪除此訓練紀錄"
  ],
  "cancelHasSets": [
    "This workout has recorded sets. Choose whether to keep them or explicitly delete the workout.",
    "这次训练已有记录组。请选择保留已做部分，或明确删除整次记录。",
    "此次訓練已有紀錄組。請選擇保留已做部分，或明確刪除整次紀錄。"
  ],
  "cancelEmpty": [
    "Cancel this empty workout?",
    "取消这次空白训练？",
    "取消此次空白訓練？"
  ],
  "pendingFinish": [
    "Finished on this device · waiting to sync",
    "本机已结束 · 等待同步",
    "本機已結束 · 等待同步"
  ],
  "pendingNotice": [
    "Local changes are shown here. Server totals change only after a successful receipt.",
    "这里显示本机待同步内容，成功回执后才进入服务端合计。",
    "此處顯示本機待同步內容，成功回執後才進入伺服器合計。"
  ],
  "result": [
    "Workout result",
    "本次结果",
    "本次結果"
  ],
  "totalSets": [
    "Recorded sets: {{count}}",
    "已记录 {{count}} 组",
    "已記錄 {{count}} 組"
  ],
  "summary": [
    "Work sets: {{work}} · type not specified: {{unknown}}",
    "已标注工作组 {{work}} · 类型未标注 {{unknown}}",
    "已標註工作組 {{work}} · 類型未標註 {{unknown}}"
  ],
  "elapsed": [
    "Elapsed, including pauses: {{minutes}} min",
    "时长（含暂停）：{{minutes}} 分钟",
    "時長（含暫停）：{{minutes}} 分鐘"
  ],
  "lastTime": [
    "Last same configuration: {{date}}",
    "上次同配置：{{date}}",
    "上次同設定：{{date}}"
  ],
  "noHistory": [
    "No previous sets for this configuration.",
    "这个配置还没有历史组。",
    "這個設定尚無歷史組。"
  ],
  "prefill": [
    "Use previous set as a reference",
    "填入上次组作为参考",
    "填入上次組作為參考"
  ],
  "previousUnit": [
    "The reference keeps its original unit; confirm it before saving.",
    "参考值保留原单位，请核对后再保存。",
    "參考值保留原單位，請核對後再儲存。"
  ],
  "pending": [
    "Pending training changes",
    "待同步训练操作",
    "待同步訓練操作"
  ],
  "review": [
    "Review current record",
    "核对当前记录",
    "核對目前紀錄"
  ],
  "conflictHelp": [
    "Your input is kept. Review the current record before creating a new operation; discard obsolete dependent operations first.",
    "你的输入已保留。请核对当前记录，再另行提交；依赖旧操作的内容需要逐条处理。",
    "你的輸入已保留。請核對目前紀錄，再重新提交；依賴舊操作的內容需逐筆處理。"
  ],
  "invalid": [
    "Check repetitions (1–200), load, date and optional RPE (1–10, steps of 0.5).",
    "请检查次数（1–200）、重量、日期及选填 RPE（1–10，步长 0.5）。",
    "請檢查次數（1–200）、重量、日期及選填 RPE（1–10，間隔 0.5）。"
  ],
  "recordGone": [
    "This workout is unavailable or deleted. Pending input remains on this device.",
    "这次训练不可用或已删除，待处理输入仍保留在本机。",
    "此次訓練無法使用或已刪除，待處理輸入仍保留在本機。"
  ],
  "back": [
    "Back to workouts",
    "返回训练列表",
    "返回訓練列表"
  ],
  "saveError": [
    "Could not save locally. Your input remains; try again.",
    "本机保存失败，输入仍保留，请重试。",
    "本機儲存失敗，輸入仍保留，請重試。"
  ],
  "target": [
    "Plan: {{sets}} sets · {{min}}–{{max}} reps",
    "计划：{{sets}} 组 · {{min}}–{{max}} 次",
    "計畫：{{sets}} 組 · {{min}}–{{max}} 次"
  ],
  "bodyweight": [
    "Bodyweight only",
    "仅自重",
    "僅自重"
  ],
  "unnamed": [
    "Untitled workout",
    "未命名训练",
    "未命名訓練"
  ],
  "blocked": [
    "Resolve pending conflicts before adding more changes.",
    "请先处理待核对的冲突，再提交新修改。",
    "請先處理待核對的衝突，再提交新修改。"
  ],
  "unitPreference": [
    "Use {{unit}} for new sets in this configuration",
    "此配置的新组默认使用 {{unit}}",
    "此設定的新組預設使用 {{unit}}"
  ],
  "semantics_external_total": [
    "Total external load",
    "总外部重量",
    "總外部重量"
  ],
  "semantics_per_side": [
    "Each side / dumbbell",
    "每只／每侧",
    "每隻／每側"
  ],
  "semantics_added_weight": [
    "Added weight",
    "额外负重",
    "額外負重"
  ],
  "semantics_assistance": [
    "Assistance",
    "助力重量",
    "助力重量"
  ],
  "semantics_bodyweight_only": [
    "Bodyweight only",
    "仅自重",
    "僅自重"
  ],
  "semantics_unspecified": [
    "Load meaning not specified",
    "重量含义未指定",
    "重量含義未指定"
  ],
  "status_in_progress": [
    "In progress",
    "进行中",
    "進行中"
  ],
  "status_paused": [
    "Paused",
    "已暂停",
    "已暫停"
  ],
  "status_completed": [
    "Completed",
    "已结束",
    "已結束"
  ],
  "status_cancelled": [
    "Cancelled",
    "已取消",
    "已取消"
  ],
  "status_deleted": [
    "Deleted",
    "已删除",
    "已刪除"
  ],
  "status_draft": [
    "Draft",
    "草稿",
    "草稿"
  ],
  "type_unknown": [
    "Not specified",
    "未标注",
    "未標註"
  ],
  "type_work": [
    "Work",
    "工作组",
    "工作組"
  ],
  "type_warmup": [
    "Warm-up",
    "热身组",
    "暖身組"
  ],
  "type_backoff": [
    "Back-off",
    "回退组",
    "回退組"
  ],
  "type_drop": [
    "Drop",
    "递减组",
    "遞減組"
  ],
  "equipment_barbell": [
    "Barbell",
    "杠铃",
    "槓鈴"
  ],
  "equipment_dumbbell": [
    "Dumbbells",
    "哑铃",
    "啞鈴"
  ],
  "equipment_cable": [
    "Cable",
    "绳索",
    "滑輪"
  ],
  "equipment_machine": [
    "Machine",
    "器械",
    "器械"
  ],
  "equipment_smith": [
    "Smith machine",
    "史密斯机",
    "史密斯機"
  ],
  "equipment_bodyweight": [
    "Bodyweight",
    "自重",
    "自重"
  ],
  "equipment_band": [
    "Resistance band",
    "弹力带",
    "彈力帶"
  ],
  "equipment_kettlebell": [
    "Kettlebell",
    "壶铃",
    "壺鈴"
  ],
  "equipment_other": [
    "Other",
    "其他",
    "其他"
  ],
  "equipment_unspecified": [
    "Not specified",
    "未指定",
    "未指定"
  ],
  "angle_flat": [
    "Flat",
    "平板",
    "平板"
  ],
  "angle_incline": [
    "Incline",
    "上斜",
    "上斜"
  ],
  "angle_decline": [
    "Decline",
    "下斜",
    "下斜"
  ],
  "angle_unspecified": [
    "Not specified",
    "未指定",
    "未指定"
  ],
  "grip_neutral": [
    "Neutral",
    "中立握",
    "中立握"
  ],
  "grip_pronated": [
    "Pronated",
    "正握",
    "正握"
  ],
  "grip_supinated": [
    "Supinated",
    "反握",
    "反握"
  ],
  "grip_mixed": [
    "Mixed",
    "混合握",
    "混合握"
  ],
  "grip_unspecified": [
    "Not specified",
    "未指定",
    "未指定"
  ],
  "laterality_bilateral": [
    "Both sides",
    "双侧",
    "雙側"
  ],
  "laterality_unilateral": [
    "One side",
    "单侧",
    "單側"
  ],
  "laterality_alternating": [
    "Alternating",
    "交替",
    "交替"
  ],
  "laterality_unspecified": [
    "Not specified",
    "未指定",
    "未指定"
  ]
};
export function trainingLocale(index: 0 | 1 | 2): Record<string, string> { return Object.fromEntries(Object.entries(strings).map(([key, values]) => [key, values[index]])); }
