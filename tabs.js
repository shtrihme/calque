// Вкладки: несколько расчётов в одном браузере
(function () {
    var STORE = 'calque_docs';

    function load() {
        try {
            var data = JSON.parse(localStorage.getItem(STORE));
            if (data && data.docs && data.docs.length) return data;
        } catch (e) { /* нет данных или приватный режим */ }
        return null;
    }

    function newId() {
        return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    }

    // Название — первая непустая строка без решётки
    function titleOf(text) {
        var line = (text.split('\n').find(function (l) { return l.trim(); }) || '').replace(/^\s*#\s*/, '').trim();
        if (!line) return 'Без названия';
        return line.length > 24 ? line.slice(0, 23) + '…' : line;
    }

    function Tabs(barEl, calque, data) {
        this.bar = barEl;
        this.calque = calque;
        this.data = data;
        this.scroll = {};
        this.render();
    }

    Tabs.prototype.save = function () {
        try { localStorage.setItem(STORE, JSON.stringify(this.data)); } catch (e) { /* ничего */ }
    };

    Tabs.prototype.active = function () {
        var id = this.data.active;
        return this.data.docs.find(function (d) { return d.id === id; }) || this.data.docs[0];
    };

    Tabs.prototype.onChange = function (text) {
        var doc = this.active();
        if (!doc || doc.text === text) return;
        doc.text = text;
        this.save();
        var el = this.bar.querySelector('[data-id="' + doc.id + '"] .tab-title');
        if (el) el.textContent = titleOf(text);
    };

    Tabs.prototype.open = function (id) {
        var current = this.active();
        if (current) this.scroll[current.id] = window.scrollY;
        this.data.active = id;
        this.save();
        this.calque.setText(this.active().text);
        this.render();
        window.scrollTo(0, this.scroll[id] || 0);
        this.calque.inputEl.focus({ preventScroll: true });
    };

    Tabs.prototype.add = function (text) {
        var doc = { id: newId(), text: text };
        this.data.docs.push(doc);
        this.open(doc.id);
        if (text === '') this.calque.inputEl.focus();
    };

    Tabs.prototype.close = function (id) {
        var docs = this.data.docs;
        var i = docs.findIndex(function (d) { return d.id === id; });
        if (i < 0) return;
        var doc = docs[i];
        if (doc.text.trim() && !window.confirm('Удалить «' + titleOf(doc.text) + '»?')) return;
        docs.splice(i, 1);
        if (!docs.length) docs.push({ id: newId(), text: '' });
        var next = docs[Math.min(i, docs.length - 1)];
        if (this.data.active === id) {
            this.open(next.id);
        } else {
            this.save();
            this.render();
        }
    };

    Tabs.prototype.render = function () {
        var tabs = this;
        var bar = tabs.bar;
        bar.innerHTML = '';
        var activeId = tabs.active().id;

        tabs.data.docs.forEach(function (doc) {
            var tab = document.createElement('div');
            tab.className = 'tab' + (doc.id === activeId ? ' active' : '');
            tab.dataset.id = doc.id;

            var title = document.createElement('span');
            title.className = 'tab-title';
            title.textContent = titleOf(doc.text);
            tab.appendChild(title);

            if (doc.id === activeId) {
                var x = document.createElement('button');
                x.type = 'button';
                x.className = 'tab-close';
                x.textContent = '×';
                x.title = 'Закрыть вкладку';
                x.onmousedown = function (e) { e.preventDefault(); };
                x.onclick = function (e) { e.stopPropagation(); tabs.close(doc.id); };
                tab.appendChild(x);
            }

            tab.onmousedown = function (e) { e.preventDefault(); };
            tab.onclick = function () { if (doc.id !== tabs.active().id) tabs.open(doc.id); };
            bar.appendChild(tab);
        });

        var plus = document.createElement('button');
        plus.type = 'button';
        plus.className = 'tab-add';
        plus.textContent = '+';
        plus.title = 'Новый расчёт';
        plus.onmousedown = function (e) { e.preventDefault(); };
        plus.onclick = function () { tabs.add(''); };
        bar.appendChild(plus);

        var active = bar.querySelector('.tab.active');
        if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    };

    // Запуск страницы: вкладки, перенос старого документа, открытие ссылки
    Tabs.start = function (options) {
        var input = options.input;
        var data = load();

        if (!data) {
            var old = null;
            try { old = localStorage.getItem('input'); } catch (e) { /* ничего */ }
            var first = { id: newId(), text: old !== null ? old : input.value };
            data = { docs: [first], active: first.id };
        }

        var tabs;
        var calque = new Calque(input, options.output, {
            toolbar: options.toolbar,
            storageKey: null,
            onChange: function (text) { if (tabs) tabs.onChange(text); }
        });

        var doc = data.docs.find(function (d) { return d.id === data.active; }) || data.docs[0];
        data.active = doc.id;
        calque.setText(doc.text);

        tabs = new Tabs(options.bar, calque, data);
        tabs.save();
        window.calque = calque;
        window.calqueTabs = tabs;

        function openHash() {
            if (location.hash.length <= 3) return;
            Calque.decodeText(location.hash).then(function (shared) {
                history.replaceState(null, '', location.pathname + location.search);
                if (shared === null) return;
                var same = tabs.data.docs.find(function (d) { return d.text === shared; });
                if (same) {
                    tabs.open(same.id);
                    calque.toast('Этот расчёт уже открыт');
                } else {
                    tabs.add(shared);
                    calque.toast('Расчёт из ссылки открыт в новой вкладке');
                }
            });
        }
        openHash();
        // Ссылку могут вставить в адресную строку уже открытой страницы
        window.addEventListener('hashchange', openHash);

        input.focus({ preventScroll: true });
        return tabs;
    };

    Tabs.titleOf = titleOf;
    window.CalqueTabs = Tabs;
})();
