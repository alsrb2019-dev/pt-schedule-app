(function () {
  "use strict";

  var STORAGE_KEY = "schedule-app-data-v2";
  var WEEKDAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"];
  var DAY_MS = 86400000;

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function dateToKey(d) {
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }

  function keyToDate(key) {
    var parts = key.split("-").map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }

  function startOfDay(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  function startOfToday() {
    return startOfDay(new Date());
  }

  function addDays(date, n) {
    var d = new Date(date);
    d.setDate(d.getDate() + n);
    return d;
  }

  function todayKey() {
    return dateToKey(new Date());
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function loadData() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      var parsed = raw ? JSON.parse(raw) : null;
      if (!parsed) return { bookings: {}, recurring: [], todos: {} };
      parsed.bookings = parsed.bookings || {};
      parsed.recurring = parsed.recurring || [];
      parsed.todos = parsed.todos || {};
      return parsed;
    } catch (e) {
      return { bookings: {}, recurring: [], todos: {} };
    }
  }

  function saveData() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      /* storage unavailable (private mode / quota) — ignore */
    }
  }

  var data = loadData();

  // ---- parsing quick-add text: "회원이름 [매주|격주] 요일/날짜 시간 [시간2]" ----

  function resolveYear(month, day) {
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    var now = new Date();
    var d = new Date(now.getFullYear(), month - 1, day);
    if (d.getMonth() !== month - 1) return null; // invalid day-of-month (e.g. 2/30)
    if (d < startOfToday()) d = new Date(now.getFullYear() + 1, month - 1, day);
    return d;
  }

  function findBareWeekday(text) {
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      var idx = WEEKDAY_NAMES.indexOf(ch);
      if (idx === -1) continue;
      var prev = text[i - 1];
      if (prev && /\d/.test(prev)) continue; // skip e.g. the "일" in "28일"
      return idx;
    }
    return -1;
  }

  function parseDateInfo(text) {
    var m = text.match(/(\d{1,2})\s*[\/.]\s*(\d{1,2})/);
    if (m) {
      var d1 = resolveYear(+m[1], +m[2]);
      if (d1) return { kind: "date", date: d1 };
    }
    m = text.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
    if (m) {
      var d2 = resolveYear(+m[1], +m[2]);
      if (d2) return { kind: "date", date: d2 };
    }
    if (/오늘/.test(text)) return { kind: "date", date: startOfToday() };
    if (/내일/.test(text)) return { kind: "date", date: addDays(startOfToday(), 1) };
    if (/모레/.test(text)) return { kind: "date", date: addDays(startOfToday(), 2) };

    m = text.match(/(?:매주|격주)\s*([일월화수목금토])/);
    if (m) return { kind: "weekday", weekday: WEEKDAY_NAMES.indexOf(m[1]) };

    var wd = findBareWeekday(text);
    if (wd !== -1) return { kind: "weekday", weekday: wd };

    return null;
  }

  // Pulls every time expression out of the text; `remaining` is the text without them,
  // so "14:00/19:00" can't be mistaken for a "00/19" date.
  function extractTimes(text) {
    var re = /(오전|오후)?\s*(?:(\d{1,2}):(\d{2})|(\d{1,2})\s*시(?:\s*(\d{1,2})\s*분)?)/g;
    var times = [];
    var m;
    while ((m = re.exec(text)) !== null) {
      var ampm = m[1] === "오전" ? "am" : m[1] === "오후" ? "pm" : null;
      var hour, min, bare;
      if (m[2] !== undefined) {
        hour = +m[2];
        min = +m[3];
        bare = false;
      } else {
        hour = +m[4];
        min = m[5] ? +m[5] : 0;
        bare = true;
      }
      if (hour > 23 || min > 59) return { error: "시간 형식을 확인해주세요. 예) 14:00, 오후 2시" };
      if (ampm === "am" && hour === 12) hour = 0;
      if (ampm === "pm" && hour < 12) hour += 12;
      if (!ampm && bare && hour >= 1 && hour <= 7) hour += 12; // bare small hour → assume PM (evening session)
      times.push(pad2(hour) + ":" + pad2(min));
    }
    return { times: times, remaining: text.replace(re, " ") };
  }

  // A whole token that starts the schedule part; whole-token match keeps names like "김수현" safe.
  function isScheduleToken(tok) {
    if (/^\d/.test(tok)) return true;
    if (/^(매주|격주)/.test(tok)) return true;
    if (/^(오늘|내일|모레|오전|오후)$/.test(tok)) return true;
    if (/^[일월화수목금토](요일)?$/.test(tok)) return true;
    if (/^[일월화수목금토]요일/.test(tok)) return true;
    return false;
  }

  function parseQuickAdd(raw) {
    var name, rest;
    var commaIdx = raw.indexOf(",");
    var afterComma = commaIdx !== -1 ? raw.slice(commaIdx + 1) : "";
    var head = commaIdx !== -1 ? raw.slice(0, commaIdx).trim() : "";
    // "김철수, 월 14:00" uses the comma as the name boundary; "김철수 월 14:00, 19:00" does not
    var commaIsBoundary = head && afterComma.trim() && !/^\s*(오전|오후)?\s*\d{1,2}\s*(:\d{2}|시)/.test(afterComma);

    if (commaIsBoundary) {
      name = head;
      rest = afterComma.trim();
    } else {
      var tokens = raw.replace(/,/g, " ").trim().split(/\s+/);
      var i = 0;
      while (i < tokens.length && !isScheduleToken(tokens[i])) i++;
      name = tokens.slice(0, i).join(" ");
      rest = tokens.slice(i).join(" ");
    }
    if (!name) return { error: "회원 이름을 입력해주세요. 예) 김철수 월 14:00" };
    if (!rest) return { error: "요일/날짜와 시간을 입력해주세요. 예) 김철수 월 14:00" };

    var ext = extractTimes(rest);
    var dateInfo = parseDateInfo(ext.remaining !== undefined ? ext.remaining : rest);
    if (!dateInfo) return { error: "요일이나 날짜를 알 수 없어요. 예) 월, 격주 월, 9/28, 오늘" };
    if (ext.error) return { error: ext.error };
    if (ext.times.length === 0) return { error: "시간을 알 수 없어요. 예) 14:00, 오후 2시" };
    if (ext.times.length > 2) return { error: "시간은 최대 2개까지 쓸 수 있어요. (한 주씩 번갈아 적용)" };

    var interval = /격주/.test(rest) ? 2 : 1;
    var repeat = /격주|매주/.test(rest);
    var alternating = ext.times.length === 2;
    if (alternating && interval === 2) {
      return { error: "격주와 시간 2개는 같이 쓸 수 없어요. 시간 2개는 매주 번갈아 적용돼요." };
    }

    if (dateInfo.kind === "weekday") {
      // biweekly / alternating need a fixed start week so the parity stays put
      var anchor = interval === 2 || alternating ? dateToKey(nextOccurrence(dateInfo.weekday)) : null;
      return { name: name, recurring: true, weekday: dateInfo.weekday, times: ext.times, interval: interval, anchor: anchor };
    }
    if (repeat || alternating) {
      return {
        name: name,
        recurring: true,
        weekday: dateInfo.date.getDay(),
        times: ext.times,
        interval: interval,
        anchor: dateToKey(dateInfo.date)
      };
    }
    return { name: name, recurring: false, date: dateInfo.date, time: ext.times[0] };
  }

  // ---- bookings ----

  function nextOccurrence(weekday) {
    var d = startOfToday();
    while (d.getDay() !== weekday) d = addDays(d, 1);
    return d;
  }

  function entryTimes(r) {
    return r.times && r.times.length ? r.times : [r.time];
  }

  // Time of this recurring entry on the given date, or null when it doesn't meet that day.
  function classTimeOn(r, dateObj) {
    if (r.weekday !== dateObj.getDay()) return null;
    var times = entryTimes(r);
    if (!r.anchor) return times[0];
    var diffDays = Math.round((startOfDay(dateObj) - keyToDate(r.anchor)) / DAY_MS);
    if (diffDays < 0) return null;
    var week = Math.round(diffDays / 7);
    if ((r.interval || 1) === 2) return week % 2 === 0 ? times[0] : null;
    return times[week % times.length];
  }

  function recurLabel(r) {
    if ((r.interval || 1) === 2) return "격주";
    return entryTimes(r).length > 1 ? "교대" : "매주";
  }

  function describeRecurring(r) {
    var w = WEEKDAY_NAMES[r.weekday] + "요일 ";
    var since = r.anchor ? " (" + formatDateShort(keyToDate(r.anchor)) + "부터)" : "";
    var times = entryTimes(r);
    if ((r.interval || 1) === 2) return "격주 " + w + times[0] + since;
    if (times.length > 1) return "매주 " + w + times.join(" / ") + " 교대" + since;
    return "매주 " + w + times[0] + since;
  }

  function recurringConflict(a, b) {
    if (a.weekday !== b.weekday) return false;
    var d = startOfToday();
    [a.anchor, b.anchor].forEach(function (k) {
      if (k && keyToDate(k) > d) d = keyToDate(k);
    });
    while (d.getDay() !== a.weekday) d = addDays(d, 1);
    for (var i = 0; i < 4; i++, d = addDays(d, 7)) {
      var ta = classTimeOn(a, d);
      var tb = classTimeOn(b, d);
      if (ta !== null && ta === tb) return true;
    }
    return false;
  }

  function getEffectiveClasses(dateObj) {
    var key = dateToKey(dateObj);
    var oneTime = (data.bookings[key] || []).map(function (b) {
      return { id: b.id, time: b.time, name: b.name, recurring: false };
    });
    var rec = [];
    data.recurring.forEach(function (r) {
      var t = classTimeOn(r, dateObj);
      if (t !== null) rec.push({ id: r.id, time: t, name: r.name, recurring: true, label: recurLabel(r) });
    });
    return oneTime.concat(rec).sort(function (a, b) {
      return a.time.localeCompare(b.time);
    });
  }

  function hasSlotConflict(parsed) {
    if (parsed.recurring) {
      return data.recurring.some(function (r) {
        return recurringConflict(r, parsed);
      });
    }
    return getEffectiveClasses(parsed.date).some(function (c) {
      return c.time === parsed.time;
    });
  }

  function registerBooking(parsed) {
    if (parsed.recurring) {
      data.recurring.push({
        id: uid(),
        name: parsed.name,
        weekday: parsed.weekday,
        time: parsed.times[0],
        times: parsed.times,
        interval: parsed.interval,
        anchor: parsed.anchor
      });
    } else {
      var key = dateToKey(parsed.date);
      if (!data.bookings[key]) data.bookings[key] = [];
      data.bookings[key].push({ id: uid(), time: parsed.time, name: parsed.name });
    }
    saveData();
  }

  function formatDateShort(date) {
    return date.getMonth() + 1 + "/" + date.getDate();
  }

  // ---- todos ----

  function getTodos(key) {
    if (!data.todos[key]) data.todos[key] = [];
    return data.todos[key];
  }

  function pruneEmptyDay(key) {
    if (data.bookings[key] && data.bookings[key].length === 0) delete data.bookings[key];
    if (data.todos[key] && data.todos[key].length === 0) delete data.todos[key];
  }

  // ---- view state ----

  var view = new Date();
  view.setDate(1);
  var selectedKey = todayKey();

  var monthLabel = document.getElementById("monthLabel");
  var calendarGrid = document.getElementById("calendarGrid");
  var selectedDateLabel = document.getElementById("selectedDateLabel");
  var classList = document.getElementById("classList");
  var todoList = document.getElementById("todoList");
  var quickAddMsg = document.getElementById("quickAddMsg");

  var msgTimer = null;
  function showMsg(text, kind) {
    quickAddMsg.textContent = text;
    quickAddMsg.className = "quick-add-msg " + kind;
    clearTimeout(msgTimer);
    msgTimer = setTimeout(function () {
      quickAddMsg.textContent = "";
      quickAddMsg.className = "quick-add-msg";
    }, 5000);
  }

  function renderMonthLabel() {
    monthLabel.textContent = view.getFullYear() + "년 " + (view.getMonth() + 1) + "월";
  }

  function renderCalendar() {
    renderMonthLabel();
    calendarGrid.innerHTML = "";

    var year = view.getFullYear();
    var month = view.getMonth();
    var firstDow = new Date(year, month, 1).getDay();
    var daysInMonth = new Date(year, month + 1, 0).getDate();
    var daysInPrevMonth = new Date(year, month, 0).getDate();
    var todayStr = todayKey();

    var cells = [];
    for (var i = firstDow - 1; i >= 0; i--) {
      cells.push({ date: new Date(year, month - 1, daysInPrevMonth - i), otherMonth: true });
    }
    for (var d = 1; d <= daysInMonth; d++) {
      cells.push({ date: new Date(year, month, d), otherMonth: false });
    }
    while (cells.length % 7 !== 0) {
      var next = cells.length - (firstDow + daysInMonth) + 1;
      cells.push({ date: new Date(year, month + 1, next), otherMonth: true });
    }

    cells.forEach(function (cell) {
      var key = dateToKey(cell.date);
      var dow = cell.date.getDay();
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "day-cell";
      if (cell.otherMonth) btn.classList.add("other-month");
      if (dow === 0) btn.classList.add("sunday");
      if (dow === 6) btn.classList.add("saturday");
      if (key === todayStr) btn.classList.add("today");
      if (key === selectedKey) btn.classList.add("selected");
      btn.dataset.key = key;

      var num = document.createElement("span");
      num.className = "day-num";
      num.textContent = cell.date.getDate();
      btn.appendChild(num);

      var hasClass = (data.bookings[key] && data.bookings[key].length > 0) ||
        data.recurring.some(function (r) { return classTimeOn(r, cell.date) !== null; });
      var hasTodo = data.todos[key] && data.todos[key].length > 0;

      var dotRow = document.createElement("span");
      dotRow.className = "dot-row";
      if (hasClass) {
        var e = document.createElement("span");
        e.className = "dot event";
        dotRow.appendChild(e);
      }
      if (hasTodo) {
        var t = document.createElement("span");
        t.className = "dot todo";
        dotRow.appendChild(t);
      }
      btn.appendChild(dotRow);

      btn.addEventListener("click", function () {
        selectedKey = key;
        var clicked = cell.date;
        if (clicked.getMonth() !== view.getMonth() || clicked.getFullYear() !== view.getFullYear()) {
          view = new Date(clicked.getFullYear(), clicked.getMonth(), 1);
        }
        renderCalendar();
        renderDayPanel();
      });

      calendarGrid.appendChild(btn);
    });
  }

  function formatSelectedLabel(key) {
    var d = keyToDate(key);
    var label = d.getMonth() + 1 + "월 " + d.getDate() + "일 (" + WEEKDAY_NAMES[d.getDay()] + ")";
    if (key === todayKey()) label += " · 오늘";
    return label;
  }

  function renderDayPanel() {
    selectedDateLabel.textContent = formatSelectedLabel(selectedKey);
    var dateObj = keyToDate(selectedKey);
    var classes = getEffectiveClasses(dateObj);

    classList.innerHTML = "";
    if (classes.length === 0) {
      classList.innerHTML = '<li class="empty-hint">등록된 수업이 없습니다</li>';
    } else {
      classes.forEach(function (c) {
        var li = document.createElement("li");
        li.className = "item-row";

        var timeSpan = document.createElement("span");
        timeSpan.className = "item-time";
        timeSpan.textContent = c.time;

        var textSpan = document.createElement("span");
        textSpan.className = "item-text";
        textSpan.textContent = c.name;

        li.appendChild(timeSpan);
        li.appendChild(textSpan);

        if (c.recurring) {
          var badge = document.createElement("span");
          badge.className = "badge";
          badge.textContent = c.label;
          li.appendChild(badge);
        }

        var delBtn = document.createElement("button");
        delBtn.className = "delete-btn";
        delBtn.type = "button";
        delBtn.textContent = "×";
        delBtn.addEventListener("click", function () {
          if (c.recurring) {
            if (!confirm(c.name + "님의 " + c.label + " " + WEEKDAY_NAMES[dateObj.getDay()] + "요일 수업을 전체 삭제할까요?")) return;
            data.recurring = data.recurring.filter(function (r) {
              return r.id !== c.id;
            });
          } else {
            data.bookings[selectedKey] = (data.bookings[selectedKey] || []).filter(function (b) {
              return b.id !== c.id;
            });
            pruneEmptyDay(selectedKey);
          }
          saveData();
          renderCalendar();
          renderDayPanel();
        });
        li.appendChild(delBtn);

        classList.appendChild(li);
      });
    }

    var todos = getTodos(selectedKey);
    todoList.innerHTML = "";
    if (todos.length === 0) {
      todoList.innerHTML = '<li class="empty-hint">할 일이 없습니다</li>';
    } else {
      todos.forEach(function (todo) {
        var li = document.createElement("li");
        li.className = "item-row" + (todo.done ? " done" : "");
        var check = document.createElement("button");
        check.type = "button";
        check.className = "checkbox" + (todo.done ? " checked" : "");
        check.addEventListener("click", function () {
          todo.done = !todo.done;
          saveData();
          renderDayPanel();
        });
        var textSpan = document.createElement("span");
        textSpan.className = "item-text";
        textSpan.textContent = todo.text;
        var delBtn = document.createElement("button");
        delBtn.className = "delete-btn";
        delBtn.type = "button";
        delBtn.textContent = "×";
        delBtn.addEventListener("click", function () {
          data.todos[selectedKey] = getTodos(selectedKey).filter(function (x) {
            return x.id !== todo.id;
          });
          pruneEmptyDay(selectedKey);
          saveData();
          renderCalendar();
          renderDayPanel();
        });
        li.appendChild(check);
        li.appendChild(textSpan);
        li.appendChild(delBtn);
        todoList.appendChild(li);
      });
    }
  }

  // ---- events ----

  document.getElementById("prevMonth").addEventListener("click", function () {
    view = new Date(view.getFullYear(), view.getMonth() - 1, 1);
    renderCalendar();
  });

  document.getElementById("nextMonth").addEventListener("click", function () {
    view = new Date(view.getFullYear(), view.getMonth() + 1, 1);
    renderCalendar();
  });

  document.getElementById("todayBtn").addEventListener("click", function () {
    var now = new Date();
    view = new Date(now.getFullYear(), now.getMonth(), 1);
    selectedKey = todayKey();
    renderCalendar();
    renderDayPanel();
  });

  document.getElementById("quickAddForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var input = document.getElementById("quickAddInput");
    var raw = input.value.trim();
    if (!raw) return;

    var parsed = parseQuickAdd(raw);
    if (parsed.error) {
      showMsg(parsed.error, "error");
      return;
    }

    var label = parsed.recurring ? describeRecurring(parsed) : formatDateShort(parsed.date) + " " + parsed.time;

    if (hasSlotConflict(parsed)) {
      showMsg(label + "에 이미 다른 수업이 있어요.", "error");
      return;
    }

    registerBooking(parsed);
    input.value = "";
    showMsg(parsed.name + "님 " + label + " 등록완료", "success");

    var targetDate = parsed.recurring
      ? parsed.anchor ? keyToDate(parsed.anchor) : nextOccurrence(parsed.weekday)
      : parsed.date;
    selectedKey = dateToKey(targetDate);
    view = new Date(targetDate.getFullYear(), targetDate.getMonth(), 1);
    renderCalendar();
    renderDayPanel();
  });

  document.getElementById("classForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var timeInput = document.getElementById("classTime");
    var nameInput = document.getElementById("classMember");
    var name = nameInput.value.trim();
    if (!name || !timeInput.value) return;

    var dateObj = keyToDate(selectedKey);
    var parsed = { name: name, recurring: false, date: dateObj, time: timeInput.value };

    if (hasSlotConflict(parsed)) {
      showMsg(formatDateShort(dateObj) + " " + parsed.time + "에 이미 다른 수업이 있어요.", "error");
      return;
    }

    if (!data.bookings[selectedKey]) data.bookings[selectedKey] = [];
    data.bookings[selectedKey].push({ id: uid(), time: parsed.time, name: name });
    saveData();
    nameInput.value = "";
    timeInput.value = "";
    renderCalendar();
    renderDayPanel();
  });

  document.getElementById("todoForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var titleInput = document.getElementById("todoTitle");
    var text = titleInput.value.trim();
    if (!text) return;
    getTodos(selectedKey).push({ id: uid(), text: text, done: false });
    saveData();
    titleInput.value = "";
    renderCalendar();
    renderDayPanel();
  });

  renderCalendar();
  renderDayPanel();

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").catch(function () {
        /* offline caching is best-effort */
      });
    });
  }
})();
