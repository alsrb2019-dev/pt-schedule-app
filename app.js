(function () {
  "use strict";

  var STORAGE_KEY = "schedule-app-data-v2";
  var WEEKDAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"];

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function dateToKey(d) {
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }

  function startOfToday() {
    var n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate());
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

  // ---- parsing "회원이름, 수업시간" quick-add text ----

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

    m = text.match(/매주\s*([일월화수목금토])/);
    if (m) return { kind: "weekday", weekday: WEEKDAY_NAMES.indexOf(m[1]) };

    var wd = findBareWeekday(text);
    if (wd !== -1) return { kind: "weekday", weekday: wd };

    return null;
  }

  function parseTimeText(text) {
    var ampm = null;
    if (/오전/.test(text)) ampm = "am";
    else if (/오후/.test(text)) ampm = "pm";

    var hour, min, bare;
    var m = text.match(/(\d{1,2}):(\d{2})/);
    if (m) {
      hour = +m[1];
      min = +m[2];
      bare = false;
    } else {
      m = text.match(/(\d{1,2})\s*시(?:\s*(\d{1,2})\s*분)?/);
      if (!m) return null;
      hour = +m[1];
      min = m[2] ? +m[2] : 0;
      bare = true;
    }
    if (hour > 23 || min > 59) return null;

    if (ampm === "am" && hour === 12) hour = 0;
    if (ampm === "pm" && hour < 12) hour += 12;
    if (!ampm && bare && hour >= 1 && hour <= 7) hour += 12; // bare small hour → assume PM (evening session)
    if (hour > 23) return null;

    return { hour: hour, min: min };
  }

  function parseQuickAdd(raw) {
    var commaIdx = raw.indexOf(",");
    if (commaIdx === -1) {
      return { error: "이름과 시간을 쉼표(,)로 구분해서 입력해주세요. 예) 김철수, 월 14:00" };
    }
    var name = raw.slice(0, commaIdx).trim();
    var rest = raw.slice(commaIdx + 1).trim();
    if (!name) return { error: "회원 이름을 입력해주세요." };
    if (!rest) return { error: "요일/날짜와 시간을 입력해주세요." };

    var dateInfo = parseDateInfo(rest);
    if (!dateInfo) return { error: "요일이나 날짜를 알 수 없어요. 예) 월, 9/28, 오늘" };

    var timeInfo = parseTimeText(rest);
    if (!timeInfo) return { error: "시간을 알 수 없어요. 예) 14:00, 오후 2시" };

    var time = pad2(timeInfo.hour) + ":" + pad2(timeInfo.min);

    if (dateInfo.kind === "weekday") {
      return { name: name, recurring: true, weekday: dateInfo.weekday, time: time };
    }
    return { name: name, recurring: false, date: dateInfo.date, time: time };
  }

  // ---- bookings ----

  function getEffectiveClasses(dateObj) {
    var key = dateToKey(dateObj);
    var oneTime = (data.bookings[key] || []).map(function (b) {
      return { id: b.id, time: b.time, name: b.name, recurring: false };
    });
    var wd = dateObj.getDay();
    var rec = data.recurring
      .filter(function (r) {
        return r.weekday === wd;
      })
      .map(function (r) {
        return { id: r.id, time: r.time, name: r.name, recurring: true };
      });
    return oneTime.concat(rec).sort(function (a, b) {
      return a.time.localeCompare(b.time);
    });
  }

  function hasSlotConflict(parsed) {
    if (parsed.recurring) {
      return data.recurring.some(function (r) {
        return r.weekday === parsed.weekday && r.time === parsed.time;
      });
    }
    return getEffectiveClasses(parsed.date).some(function (c) {
      return c.time === parsed.time;
    });
  }

  function registerBooking(parsed) {
    if (parsed.recurring) {
      data.recurring.push({ id: uid(), weekday: parsed.weekday, time: parsed.time, name: parsed.name });
    } else {
      var key = dateToKey(parsed.date);
      if (!data.bookings[key]) data.bookings[key] = [];
      data.bookings[key].push({ id: uid(), time: parsed.time, name: parsed.name });
    }
    saveData();
  }

  function nextOccurrence(weekday) {
    var d = startOfToday();
    while (d.getDay() !== weekday) d = addDays(d, 1);
    return d;
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
    }, 4000);
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
        data.recurring.some(function (r) { return r.weekday === dow; });
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

  function keyToDate(key) {
    var parts = key.split("-").map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2]);
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
          badge.textContent = "매주";
          li.appendChild(badge);
        }

        var delBtn = document.createElement("button");
        delBtn.className = "delete-btn";
        delBtn.type = "button";
        delBtn.textContent = "×";
        delBtn.addEventListener("click", function () {
          if (c.recurring) {
            if (!confirm(c.name + "님의 매주 " + WEEKDAY_NAMES[dateObj.getDay()] + "요일 " + c.time + " 수업을 전체 삭제할까요?")) return;
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

    if (hasSlotConflict(parsed)) {
      var label = parsed.recurring
        ? "매주 " + WEEKDAY_NAMES[parsed.weekday] + "요일 " + parsed.time
        : formatDateShort(parsed.date) + " " + parsed.time;
      showMsg(label + "에 이미 다른 수업이 있어요.", "error");
      return;
    }

    registerBooking(parsed);
    input.value = "";

    var targetDate = parsed.recurring ? nextOccurrence(parsed.weekday) : parsed.date;
    var doneLabel = parsed.recurring
      ? "매주 " + WEEKDAY_NAMES[parsed.weekday] + "요일 " + parsed.time
      : formatDateShort(parsed.date) + " " + parsed.time;
    showMsg(parsed.name + "님 " + doneLabel + " 등록완료", "success");

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
