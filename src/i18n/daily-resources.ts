const messages = {
  "trainingSummary": [
    "{{actions}} exercises · {{sets}} sets",
    "{{actions}} 个动作 · {{sets}} 组",
    "{{actions}} 個動作 · {{sets}} 組"
  ],
  "recordTraining": [
    "Record training",
    "记录训练",
    "記錄訓練"
  ],
  "deleteExercise": [
    "Delete the recorded sets for this exercise?",
    "删除这个动作的已记录组数？",
    "刪除此動作的已記錄組數？"
  ],
  "local": [
    "Saved on this device",
    "已存本机",
    "已存本機"
  ],
  "retrying": [
    "Saved locally · retrying sync",
    "已存本机，正在重试同步",
    "已存本機，正在重試同步"
  ],
  "invalidWeight": [
    "Enter a valid weight. Clearing the field does not delete a record.",
    "请输入有效体重，清空输入不会删除记录。",
    "請輸入有效體重，清空輸入不會刪除紀錄。"
  ],
  "editWeight": [
    "Edit this day’s weight",
    "修改当天体重",
    "修改當天體重"
  ],
  "deleteWeight": [
    "Delete {{value}} {{unit}} on {{date}}?",
    "删除 {{date}} 的 {{value}} {{unit}}？",
    "刪除 {{date}} 的 {{value}} {{unit}}？"
  ],
  "trend": [
    "Trend",
    "趋势",
    "趨勢"
  ],
  "days28": [
    "28 days",
    "近 28 天",
    "近 28 天"
  ],
  "chartDescription": [
    "Daily readings · 7-day average",
    "每日读数 · 七日均值",
    "每日讀數 · 七日均值"
  ],
  "insufficient": [
    "The average appears after 3 measured days in a week.",
    "一周内记录 3 天后显示均值。",
    "一週內記錄 3 天後顯示均值。"
  ]
} as const;
export function dailyLocale(index: 0 | 1 | 2) { return Object.fromEntries(Object.entries(messages).map(([key, values]) => [key, values[index]])); }
