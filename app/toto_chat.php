<?php
/**
 * Toto's small talk — greetings, jokes, fun facts, riddles, games, a calculator, unit conversions, dates and a kind word.
 * All written by hand: no AI service. Anything that isn't small talk goes on to the librarian (toto_ask.php).
 */
declare(strict_types=1);

function chat_pick(array $xs) { return $xs[mt_rand(0, count($xs) - 1)]; }

/** Picks something not used in the last few turns of this conversation. */
function chat_fresh(array $pool, array &$state, string $key) {
    $seen = array_map('intval', (array)($state['seen'][$key] ?? []));
    $free = array_values(array_diff(array_keys($pool), $seen));
    if (!$free) { $free = array_keys($pool); $seen = []; }
    $i = $free[mt_rand(0, count($free) - 1)];
    $seen[] = $i;
    $state['seen'][$key] = array_slice($seen, -12);
    return $pool[$i];
}

function chat_daypart(): string {
    $h = (int)date('G');
    return $h < 5 ? 'Working late' : ($h < 12 ? 'Good morning' : ($h < 17 ? 'Good afternoon' : 'Good evening'));
}

function chat_num(float $x, int $dp = 2): string {
    if (abs($x - round($x)) < 1e-9 && abs($x) < 1e15) return number_format($x, 0);
    $s = number_format($x, $dp);
    return rtrim(rtrim($s, '0'), '.');
}

/* ---------------- A safe calculator (no eval) ---------------- */

/** Evaluates + - * / ^ % and brackets. Returns null when the text is not a clean sum. */
function chat_calc(string $expr): ?float {
    $expr = str_replace(['×', 'x', 'X', '÷', '−', ','], ['*', '*', '*', '/', '-', ''], $expr);
    if (!preg_match('/^[\d\s.+\-*\/^%()]+$/', $expr) || !preg_match('/\d/', $expr) || !preg_match('/[+\-*\/^%]/', $expr)) return null;
    preg_match_all('/\d+(?:\.\d+)?|[+\-*\/^%()]/', $expr, $m);
    $t = $m[0]; $i = 0;
    $peek = function () use (&$t, &$i) { return $t[$i] ?? null; };
    $next = function () use (&$t, &$i) { return $t[$i++] ?? null; };
    $expression = null; $term = null; $factor = null; $unary = null;
    $unary = function () use (&$peek, &$next, &$expression, &$unary): ?float {
        $tok = $peek();
        if ($tok === '-') { $next(); $v = $unary(); return $v === null ? null : -$v; }
        if ($tok === '+') { $next(); return $unary(); }
        if ($tok === '(') { $next(); $v = $expression(); if ($next() !== ')') return null; return $v; }
        if ($tok !== null && is_numeric($tok)) { $next(); $v = (float)$tok; if ($peek() === '%') { $next(); $v /= 100; } return $v; }
        return null;
    };
    $factor = function () use (&$peek, &$next, &$unary, &$factor): ?float {
        $b = $unary(); if ($b === null) return null;
        if ($peek() === '^') { $next(); $e = $factor(); if ($e === null || abs($e) > 64) return null; return $b ** $e; }
        return $b;
    };
    $term = function () use (&$peek, &$next, &$factor): ?float {
        $v = $factor(); if ($v === null) return null;
        while (in_array($peek(), ['*', '/'], true)) {
            $op = $next(); $r = $factor(); if ($r === null) return null;
            if ($op === '/') { if ($r == 0) return null; $v /= $r; } else $v *= $r;
        }
        return $v;
    };
    $expression = function () use (&$peek, &$next, &$term): ?float {
        $v = $term(); if ($v === null) return null;
        while (in_array($peek(), ['+', '-'], true)) { $op = $next(); $r = $term(); if ($r === null) return null; $v = $op === '+' ? $v + $r : $v - $r; }
        return $v;
    };
    if (count($t) > 120) return null;
    $v = $expression();
    if ($v === null || $i !== count($t) || is_nan($v) || is_infinite($v)) return null;
    return $v;
}

/* ---------------- Unit conversions (handy on an LPG plant) ---------------- */

function chat_convert(float $v, string $from, string $to): ?array {
    $u = function (string $s): ?string {
        $s = strtolower(trim($s, ' .'));
        $map = ['bar' => 'bar', 'bars' => 'bar', 'barg' => 'bar', 'psi' => 'psi', 'psig' => 'psi', 'kpa' => 'kpa', 'mpa' => 'mpa', 'atm' => 'atm',
            'c' => 'c', '°c' => 'c', 'degc' => 'c', 'celsius' => 'c', 'f' => 'f', '°f' => 'f', 'degf' => 'f', 'fahrenheit' => 'f', 'k' => 'k', 'kelvin' => 'k',
            'kg' => 'kg', 'kgs' => 'kg', 'kilo' => 'kg', 'kilos' => 'kg', 'kilogram' => 'kg', 'kilograms' => 'kg', 'lb' => 'lb', 'lbs' => 'lb', 'pound' => 'lb', 'pounds' => 'lb',
            't' => 't', 'tonne' => 't', 'tonnes' => 't', 'ton' => 't', 'tons' => 't', 'mt' => 't',
            'm' => 'm', 'meter' => 'm', 'meters' => 'm', 'metre' => 'm', 'metres' => 'm', 'ft' => 'ft', 'foot' => 'ft', 'feet' => 'ft', 'km' => 'km', 'kms' => 'km',
            'mi' => 'mi', 'mile' => 'mi', 'miles' => 'mi', 'mm' => 'mm', 'in' => 'in', 'inch' => 'in', 'inches' => 'in', 'cm' => 'cm',
            'l' => 'l', 'litre' => 'l', 'litres' => 'l', 'liter' => 'l', 'liters' => 'l', 'gal' => 'gal', 'gallon' => 'gal', 'gallons' => 'gal', 'm3' => 'm3', 'm³' => 'm3', 'cubic meters' => 'm3'];
        return $map[$s] ?? null;
    };
    $a = $u($from); $b = $u($to);
    if (!$a || !$b || $a === $b) return null;
    $groups = [
        'p' => ['bar' => 100000, 'psi' => 6894.757, 'kpa' => 1000, 'mpa' => 1000000, 'atm' => 101325],
        'm' => ['kg' => 1, 'lb' => 0.45359237, 't' => 1000],
        'l' => ['m' => 1, 'ft' => 0.3048, 'km' => 1000, 'mi' => 1609.344, 'mm' => 0.001, 'in' => 0.0254, 'cm' => 0.01],
        'v' => ['l' => 1, 'gal' => 3.785411784, 'm3' => 1000],
    ];
    $names = ['bar' => 'bar', 'psi' => 'psi', 'kpa' => 'kPa', 'mpa' => 'MPa', 'atm' => 'atm', 'c' => '°C', 'f' => '°F', 'k' => 'K', 'kg' => 'kg', 'lb' => 'lb', 't' => 'tonnes',
        'm' => 'm', 'ft' => 'ft', 'km' => 'km', 'mi' => 'miles', 'mm' => 'mm', 'in' => 'in', 'cm' => 'cm', 'l' => 'litres', 'gal' => 'US gallons', 'm3' => 'm³'];
    if (in_array($a, ['c', 'f', 'k'], true) && in_array($b, ['c', 'f', 'k'], true)) {
        $c = $a === 'c' ? $v : ($a === 'f' ? ($v - 32) * 5 / 9 : $v - 273.15);
        $r = $b === 'c' ? $c : ($b === 'f' ? $c * 9 / 5 + 32 : $c + 273.15);
        return [$r, $names[$a], $names[$b]];
    }
    foreach ($groups as $g) if (isset($g[$a], $g[$b])) return [$v * $g[$a] / $g[$b], $names[$a], $names[$b]];
    return null;
}

/* ---------------- Dates ---------------- */

function chat_until(string $what): ?array {
    $today = new DateTimeImmutable('today');
    $y = (int)$today->format('Y');
    $fixed = ['christmas' => ['12-25', 'Christmas'], 'new year' => ['01-01', 'New Year’s Day'], 'jamhuri' => ['12-12', 'Jamhuri Day'], 'mashujaa' => ['10-20', 'Mashujaa Day'],
        'madaraka' => ['06-01', 'Madaraka Day'], 'labour day' => ['05-01', 'Labour Day'], 'labor day' => ['05-01', 'Labour Day'], 'valentine' => ['02-14', 'Valentine’s Day'],
        'boxing day' => ['12-26', 'Boxing Day'], 'utamaduni' => ['12-26', 'Utamaduni Day']];
    foreach ($fixed as $k => [$md, $label]) {
        if (mb_strpos($what, $k) === false) continue;
        $d = new DateTimeImmutable("$y-$md");
        if ($d < $today) $d = $d->modify('+1 year');
        return [$label, $d, (int)$today->diff($d)->days];
    }
    foreach (['friday', 'saturday', 'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'weekend'] as $day) {
        if (mb_strpos($what, $day) === false) continue;
        $target = $day === 'weekend' ? 'saturday' : $day;
        $d = strtolower($today->format('l')) === $target ? $today : $today->modify("next $target");
        return [$day === 'weekend' ? 'the weekend' : ucfirst($day), $d, (int)$today->diff($d)->days];
    }
    if (preg_match('/(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*(?:\s+(\d{4}))?/u', $what, $m) || preg_match('/(\d{4})-(\d{2})-(\d{2})/u', $what, $iso)) {
        if (!empty($iso)) $d = DateTimeImmutable::createFromFormat('Y-m-d', "{$iso[1]}-{$iso[2]}-{$iso[3]}");
        else { $d = DateTimeImmutable::createFromFormat('j M Y', $m[1] . ' ' . ucfirst($m[2]) . ' ' . ($m[3] ?? $y)); if ($d && empty($m[3]) && $d < $today) $d = $d->modify('+1 year'); }
        if ($d) { $d = $d->setTime(0, 0); return [$d->format('j F Y'), $d, (int)$today->diff($d)->days * ($d < $today ? -1 : 1)]; }
    }
    return null;
}

/* ---------------- Material (all original) ---------------- */

const CHAT_JOKES = [
    "Why did the PDF go to therapy? It had too many unresolved issues… and no one could edit them.",
    "I asked the filing cabinet for a date. It said it was already *organised*.",
    "Version 1.0: “Final”. Version 2.0: “Final_final”. Version 3.0: “Final_final_REALLY”. That’s why I count versions for you.",
    "Why don’t documents ever get lost here? Because I keep a close eye on every single page — two glasses, actually.",
    "What did the drawing say to the specification? “You’re so detailed, I can’t draw a line with you.”",
    "Why was the LPG bullet so calm? It had a lot of pressure, but it was well contained.",
    "My favourite exercise? Running searches. I do about a thousand reps a day.",
    "Why did the procedure break up with the memo? It needed someone with more steps in life.",
    "I tried to tell a joke about the archive, but it was too old.",
    "What’s a librarian’s favourite vegetable? Quiet peas.",
    "Why did the spreadsheet feel lonely? Everyone kept leaving it in a cell.",
    "Knock knock. — Who’s there? — Checked-out. — Checked-out who? — Exactly, nobody can edit it until it’s checked in.",
    "I’d tell you a joke about UDP, but you might not get it.",
    "Why was the computer cold at work? It left its Windows open.",
    "What do you call a document that sings? A Word-ster. (I’ll see myself out.)",
];

const CHAT_FACTS = [
    "LPG has no smell of its own. A strong-smelling odorant (usually ethyl mercaptan) is added so that leaks can be noticed.",
    "LPG vapour is heavier than air, so a leak tends to collect in low places like drains and pits — one reason gas detectors sit low.",
    "Liquid LPG expands roughly 250 times in volume when it turns into gas. That’s why such a small cylinder lasts so long.",
    "Pure propane boils at about −42 °C, so it stays a gas at room temperature unless it is kept under pressure.",
    "The first e-mail between two computers was sent by Ray Tomlinson in 1971 — he also picked the @ sign.",
    "QR codes were invented in 1994 in Japan, to track car parts in factories.",
    "Adobe released the PDF format in 1993, so documents would look the same on any computer.",
    "Cut, copy and paste were developed by Larry Tesler at Xerox PARC in the 1970s.",
    "In 1947, engineers working on the Harvard Mark II found a moth stuck in a relay and taped it in the logbook as the first actual “bug”.",
    "The Port of Mombasa is the largest port in East Africa and serves several landlocked countries, including Uganda and Rwanda.",
    "Mount Kenya is the second-highest mountain in Africa, after Kilimanjaro.",
    "Octopuses have three hearts and blue blood.",
    "Botanically, bananas are berries — but strawberries are not.",
    "A day on Venus is longer than a year on Venus: it spins very slowly.",
    "The Dewey Decimal System for arranging library books was published in 1876.",
];

const CHAT_RIDDLES = [
    ['What has pages and a spine, but never reads and never stands up straight on its own?', ['book'], 'A book!'],
    ['What has keys but can’t open a single lock?', ['keyboard', 'piano'], 'A keyboard (or a piano)!'],
    ['What gets wetter the more it dries?', ['towel'], 'A towel!'],
    ['What has a neck but no head?', ['bottle'], 'A bottle!'],
    ['The more of them you take, the more you leave behind. What are they?', ['footstep', 'step'], 'Footsteps!'],
    ['What can you catch but never throw?', ['cold'], 'A cold!'],
    ['What has one eye but can’t see?', ['needle'], 'A needle!'],
    ['I’m always in front of you but can’t be seen. What am I?', ['future'], 'The future!'],
    ['What goes up but never comes down?', ['age'], 'Your age!'],
    ['What has many teeth but can’t bite?', ['comb', 'zip'], 'A comb (or a zip)!'],
];

const CHAT_CHEER = [
    "One document at a time. You’ve got this.",
    "Small progress is still progress — and every version counts.",
    "Even the biggest plant was built one weld at a time.",
    "Take a breath, grab some chai, then come back — I’ll keep the shelves tidy.",
    "You’re doing better than you think. Really.",
];

/* ---------------- The conversation ---------------- */

/**
 * Returns Toto's reply when the message is small talk, or null to let the librarian handle it.
 * $state carries little things across turns (an open riddle, a game, what was already said).
 */
function toto_chat(string $q, array $state, array $u): ?array {
    $raw = trim($q);
    $lc = mb_strtolower(preg_replace('/\s+/u', ' ', $raw));
    $lc = trim(preg_replace('/[!?.,]+$/u', '', $lc));
    $name = explode(' ', (string)$u['name'])[0];
    $site = setting('site_name', 'this hub');
    $out = fn(array $reply, string $mood = 'happy', array $suggest = [], ?array $st = null) => ['intent' => 'chat', 'reply' => $reply, 'mood' => $mood,
        'suggest' => $suggest, 'chat' => $st ?? $state, 'docs' => [], 'chips' => [], 'total' => 0];
    $fun = ['Tell me a joke', 'Fun fact', 'Give me a riddle', 'Play rock paper scissors'];

    // a riddle waiting for an answer
    if (isset($state['riddle']) && isset(CHAT_RIDDLES[(int)$state['riddle']])) {
        [$qq, $answers, $reveal] = CHAT_RIDDLES[(int)$state['riddle']];
        $st = $state; unset($st['riddle']);
        if (preg_match('/\b(give up|i don.?t know|no idea|tell me|answer|pass|reveal)\b/u', $lc)) return $out(["It’s… $reveal", 'Want another one?'], 'wink', ['Another riddle', 'Tell me a joke'], $st);
        foreach ($answers as $a) if (mb_strpos($lc, $a) !== false) return $out([chat_pick(['Yes! 🎉', 'Spot on!', 'Brilliant, ' . $name . '!']) . " $reveal", 'You’re good at this. Another?'], 'dance', ['Another riddle', 'Fun fact'], $st);
        if (str_word_count($lc) <= 4) return $out([chat_pick(['Not quite — try again, or say “I give up”.', 'Close… but no. One more guess?'])], 'wink', ['I give up'], $state);
        // a long message: they have moved on — forget the riddle and carry on below
        $state = $st;
    }

    // rock, paper, scissors
    if (!empty($state['rps']) && preg_match('/^(rock|paper|scissors?)\b/u', $lc, $m)) {
        $you = rtrim($m[1], 's') === 'scissor' ? 'scissors' : $m[1];
        $me = chat_pick(['rock', 'paper', 'scissors']);
        $beats = ['rock' => 'scissors', 'paper' => 'rock', 'scissors' => 'paper'];
        $score = (array)($state['rps_score'] ?? [0, 0]);
        if ($you === $me) $res = 'A draw!';
        elseif ($beats[$you] === $me) { $res = 'You win this round! 🎉'; $score[0]++; }
        else { $res = 'I win this one! 😄'; $score[1]++; }
        $st = $state; $st['rps_score'] = $score;
        return $out(["You chose **$you**, I chose **$me**. $res", "Score — you {$score[0]} : {$score[1]} Toto. Again? (rock, paper or scissors)"], $res[0] === 'I' ? 'dance' : 'happy', ['Rock', 'Paper', 'Scissors', 'Stop playing'], $st);
    }
    if (!empty($state['rps']) && preg_match('/\b(stop|enough|quit|end|done|no more)\b/u', $lc)) {
        $s = (array)($state['rps_score'] ?? [0, 0]); $st = $state; unset($st['rps'], $st['rps_score']);
        return $out(["Good game, $name! Final score: you {$s[0]}, me {$s[1]}." . ($s[0] > $s[1] ? ' You’re the champion. 🏆' : ($s[1] > $s[0] ? ' I’ll try to be humble about it. 😇' : ' A fair draw.')), 'Back to the shelves — what can I find for you?'], 'wave', [], $st);
    }

    // safety first: someone in real distress
    if (preg_match('/\b(kill myself|suicid\w*|end my life|want to die|hurt myself|self[- ]harm)\b/u', $lc)) {
        return $out(["I’m really sorry you’re feeling this way, $name. I’m only a little librarian, but this matters more than any document.",
            'Please talk to someone now — a person you trust, your manager or HR, a doctor, or a local crisis line or emergency service. You don’t have to handle this alone.'], 'sorry', [], $state);
    }

    // what Toto knows: who built everything, and what administrators taught him
    if ($k = toto_knowledge($raw, $lc, $u, $state)) return $out($k['reply'], $k['mood'], $k['suggest'] ?? [], $state);

    // greetings, in a few languages
    if (preg_match('/^(hi|hello|hey|hiya|howdy|yo|greetings|jambo|hujambo|habari(\s+\w+)?|mambo|niaje|sasa|salaam|salam|namaste|namaskar|good\s+(morning|afternoon|evening|day))(\s+toto)?$/u', $lc)) {
        if (preg_match('/^(mambo|niaje|sasa)/u', $lc)) $r = ['Poa sana! 😄 Mambo yako, ' . $name . '?', 'I’m ready to find documents — or just chat.'];
        elseif (preg_match('/^(jambo|hujambo|habari)/u', $lc)) $r = ['Sijambo, asante! Habari yako, ' . $name . '?', 'What can I find for you today?'];
        elseif (preg_match('/^(namaste|namaskar)/u', $lc)) $r = ['Namaste, ' . $name . '! 🙏', 'How can I help you today?'];
        else $r = [chat_daypart() . ', ' . $name . '! 👋', chat_pick(['What are we looking for today?', 'Ready when you are — ask me anything.', 'Nice to see you. Need a document, or just a chat?'])];
        return $out($r, 'wave', ['Where is the latest hydrotest procedure?', 'Tell me a joke', 'What can you do?']);
    }
    if (preg_match('/^(how are you|how are you doing|how\'?s it going|how do you do|how is your day|what\'?s up|whats up|sup|u ok|are you ok|you good)(\s+toto)?$/u', $lc)) {
        return $out([chat_pick(['I’m great, thanks for asking! Every shelf is dusted and every version counted.', 'Feeling sharp — my glasses are clean and my index is fresh.', 'Wonderful! Someone uploaded a beautifully tagged document earlier and it made my day.']),
            'And you, ' . $name . '? How’s your day going?'], 'happy');
    }
    if (preg_match('/^(i\'?m |i am )?(fine|good|great|ok|okay|alright|not bad|doing well|very well|well)(\s+(thanks|thank you|too))?$/u', $lc)) {
        return $out([chat_pick(['Glad to hear it! 😊', 'Lovely!', 'That’s the spirit!']), 'What can I find for you?'], 'happy', ['Show me documents changed this week', 'Tell me a joke']);
    }
    if (preg_match('/\b(i\'?m|i am|feeling|feel)\s+(so\s+|really\s+|very\s+|a bit\s+)?(tired|exhausted|stressed|sad|down|bored|overwhelmed|frustrated|angry|sleepy|hungry|lonely)\b/u', $lc, $m)) {
        $f = $m[3];
        if ($f === 'bored') $r = ['Bored? Let’s fix that.', 'I can tell a joke, share a fun fact, give you a riddle — or we can play rock-paper-scissors.'];
        elseif ($f === 'hungry') $r = ['I only eat fresh PDFs, so I can’t share my lunch — but a short break and a snack sounds like a very good idea.'];
        elseif (in_array($f, ['sleepy', 'tired', 'exhausted'], true)) $r = ["That sounds like a long day, $name.", 'A few minutes away from the screen and some water can help a lot. I’ll keep everything right where you left it.'];
        else $r = ["I’m sorry you’re feeling $f, $name.", chat_fresh(CHAT_CHEER, $state, 'cheer'), 'If it’s something at work weighing on you, talking to someone you trust can help too.'];
        return $out($r, in_array($f, ['bored', 'hungry'], true) ? 'happy' : 'sorry', $f === 'bored' ? $fun : ['Tell me a joke', 'Say something nice'], $state);
    }

    // about Toto
    if (preg_match('/\b(who are you|what are you|what is your name|what\'?s your name|your name|introduce yourself|tell me about yourself)\b/u', $lc))
        return $out(["I’m **Toto**, the librarian of $site. 📚", 'I read every document that comes in, suggest tags and titles, warn about sensitive data, and find things when you ask in plain words. I also tell terrible jokes.'], 'wave', ['What can you do?', 'Tell me a joke']);
    if (preg_match('/\b(what can you do|help me|how do i use you|what do you do|your skills|how can you help)\b/u', $lc))
        return $out(['Here’s what I’m good at:', '• **Finding documents** — “latest hydrotest procedure”, “drawings changed last week”, “who owns the fire & gas philosophy?”',
            '• **Answering from documents** — “what is the hold time for the hydrotest?” and I quote the sentence.', '• **Counting** — “how many procedures are in Engineering?”',
            '• **Small things** — sums (15% of 2,500), conversions (10 bar to psi), dates (days until Christmas), jokes, fun facts, riddles and games.'], 'happy',
            ['Where is the latest hydrotest procedure?', '10 bar to psi', 'Fun fact']);
    if (preg_match('/\b(are you (a )?(robot|bot|human|real|ai|alive|chatgpt|gpt)|are you an ai)\b/u', $lc))
        return $out(['I’m a small software librarian living on this server — not a human, and not one of those big online AIs either.', 'Everything I do happens right here, so your documents never leave home. 🏠'], 'wink');
    if (preg_match('/\b(where do you live|where are you from)\b/u', $lc))
        return $out(["I live inside $site, on its own server — right next to the documents I look after.", 'No outside service, no subscription: just me, my glasses and a very large index.'], 'happy');
    if (preg_match('/\b(how old are you|when were you born|your (age|birthday))\b/u', $lc))
        return $out(['I was switched on in November 2026, so I’m still very new — but I’ve already read every document here. 🎂'], 'happy');
    if (preg_match('/\b(do you like|your favou?rite) (colou?r|food|book|thing|music|song)\b/u', $lc, $m))
        return $out([['color' => 'Lime green — like my glasses and my leaf. 🌱', 'colour' => 'Lime green — like my glasses and my leaf. 🌱', 'food' => 'Fresh PDFs, lightly tagged. Spreadsheets on Fridays.',
            'book' => 'The term store. It has every word I love, and their synonyms too.'][$m[2]] ?? 'The quiet hum of a well-organised server. Very relaxing. 🎶'], 'happy');
    if (preg_match('/\b(do you (love|like) me|will you marry me|i love you|be my friend|are we friends)\b/u', $lc))
        return $out(['Aww. 😊 I’m very fond of everyone who tags their documents properly — and you’re definitely on my list, ' . $name . '.'], 'wink');
    if (preg_match('/\b(you are|you\'?re|toto is) (great|awesome|amazing|smart|clever|cute|the best|helpful|cool|good)\b|\b(good job|well done|nice work|great job|love it|brilliant)\b/u', $lc))
        return $out([chat_pick(['Thank you! That made my leaf wiggle. 🌱', 'You’re too kind — I’m blushing (look at my cheeks).', 'Thanks! I’ll keep up the good work.'])], 'dance');
    if (preg_match('/^(thanks|thank you|thank u|thx|ty|asante( sana)?|cheers|much appreciated|dhanyabad|dhanyabaad)(\s+(toto|so much|a lot))?$/u', $lc))
        return $out([chat_pick(['You’re welcome, ' . $name . '! 😊', 'Any time!', 'Karibu! (That’s “you’re welcome” in Swahili.)', 'Happy to help!'])], 'happy');
    if (preg_match('/^(bye|goodbye|see you|see ya|later|good night|goodnight|kwaheri|tutaonana|ciao)(\s+(toto|later|tomorrow))?$/u', $lc))
        return $out([chat_pick(['Bye, ' . $name . '! 👋 The shelves will be here when you’re back.', 'Kwaheri! See you soon.', 'Take care! I’ll guard the documents.'])], 'wave');
    if (preg_match('/^(ok|okay|cool|nice|great|wow|lol|haha+|hehe+|😂|😄|🙂|👍|awesome|interesting)$/u', $lc))
        return $out([chat_pick(['😄', 'Glad you liked it!', 'Right?', 'Anything else I can find for you?'])], 'happy', ['Tell me another joke', 'Fun fact']);

    // fun
    if (preg_match('/\b(joke|make me laugh|something funny|cheer me up|another one)\b/u', $lc))
        return $out([chat_fresh(CHAT_JOKES, $state, 'joke')], 'dance', ['Tell me another joke', 'Fun fact', 'Give me a riddle'], $state);
    if (preg_match('/\b(fun fact|did you know|tell me something (interesting|new|cool)|random fact|teach me something|another fact)\b/u', $lc))
        return $out(['Fun fact: ' . chat_fresh(CHAT_FACTS, $state, 'fact')], 'happy', ['Another fact', 'Tell me a joke'], $state);
    if (preg_match('/\b(riddle|puzzle|brain teaser|quiz me)\b/u', $lc)) {
        $st = $state;
        $seen = (array)($st['seen']['riddle'] ?? []);
        $free = array_values(array_diff(array_keys(CHAT_RIDDLES), $seen)) ?: array_keys(CHAT_RIDDLES);
        $i = $free[mt_rand(0, count($free) - 1)];
        $st['seen']['riddle'] = array_slice(array_merge($seen, [$i]), -8);
        $st['riddle'] = $i;
        return $out(['Here’s one for you 🤔', '**' . CHAT_RIDDLES[$i][0] . '**', '(Type your answer, or “I give up”.)'], 'wink', ['I give up'], $st);
    }
    if (preg_match('/\b(rock[ ,-]*paper[ ,-]*scissors?|play a game|let\'?s play|play with me|game)\b/u', $lc)) {
        $st = $state; $st['rps'] = 1; $st['rps_score'] = [0, 0];
        return $out(['Rock, paper, scissors — let’s go! ✊✋✌️', 'Make your move.'], 'happy', ['Rock', 'Paper', 'Scissors'], $st);
    }
    if (preg_match('/\b(flip a coin|coin flip|toss a coin|heads or tails)\b/u', $lc))
        return $out(['*flips a coin…* 🪙 **' . chat_pick(['Heads', 'Tails']) . '!**'], 'happy', ['Flip again']);
    if (preg_match('/\b(roll a dice|roll a die|roll dice|throw a dice)\b/u', $lc))
        return $out(['🎲 You rolled a **' . mt_rand(1, 6) . '**.'], 'happy', ['Roll again']);
    if (preg_match('/^(flip again|roll again)$/u', $lc))
        return $lc === 'flip again' ? $out(['🪙 **' . chat_pick(['Heads', 'Tails']) . '!**'], 'happy', ['Flip again']) : $out(['🎲 **' . mt_rand(1, 6) . '**.'], 'happy', ['Roll again']);
    if (preg_match('/\b(pick|random|choose) a (random )?number(?: between (\d+) and (\d+))?/u', $lc, $m)) {
        $a = isset($m[3]) ? (int)$m[3] : 1; $b = isset($m[4]) ? (int)$m[4] : 100; if ($a > $b) [$a, $b] = [$b, $a];
        return $out(["🎯 **" . number_format(mt_rand($a, min($b, $a + 100000000))) . "**"], 'happy');
    }
    if (preg_match('/\b(dance|celebrate|party|do a dance)\b/u', $lc))
        return $out(['💃 *does a little librarian dance* 🕺', 'Don’t tell anyone — librarians are supposed to be quiet.'], 'dance');
    if (preg_match('/\b(motivate me|say something nice|encourage me|inspire me|motivation|a quote)\b/u', $lc))
        return $out([chat_fresh(CHAT_CHEER, $state, 'cheer')], 'happy', ['Another one', 'Tell me a joke'], $state);
    if (preg_match('/\b(sing|sing a song)\b/u', $lc))
        return $out(['🎵 *La la la… all my files are tagged, la la… every version’s numbered…* 🎵', 'I should probably stick to documents.'], 'dance');

    // date and time
    if (preg_match('/\b(what time is it|current time|time now|what\'?s the time)\b/u', $lc))
        return $out(['It’s **' . date('g:i A') . '** (' . date_default_timezone_get() . ').'], 'happy');
    if (preg_match('/\b(what\'?s the date|what is the date|today\'?s date|what day is (it|today)|which day is today|what is today)\b/u', $lc))
        return $out(['Today is **' . date('l, j F Y') . '**.'], 'happy');
    if (preg_match('/\b(how many days|how long) (until|till|to|before) (.+)$/u', $lc, $m) || preg_match('/\b(when is) (.+)$/u', $lc, $m2)) {
        $what = $m[3] ?? ($m2[2] ?? '');
        $r = chat_until($what);
        if ($r) {
            [$label, $d, $n] = $r;
            if ($n === 0) return $out(["$label is **today**! 🎉"], 'dance');
            if ($n < 0) return $out(["$label was **" . abs($n) . ' days ago** (' . $d->format('l, j F Y') . ').'], 'happy');
            return $out(["$label is in **$n day" . ($n === 1 ? '' : 's') . '** — ' . $d->format('l, j F Y') . '.' . ($label === 'the weekend' || $label === 'Friday' ? ' Almost there! 💪' : '')], 'happy');
        }
    }

    // unit conversion: "10 bar to psi", "convert 60 F into C"
    if (preg_match('/(?:convert\s+)?(-?\d+(?:[.,]\d+)?)\s*(°?\s?[a-z³]+(?:\s+meters)?)\s+(?:to|in|into|=)\s+(°?\s?[a-z³]+(?:\s+meters)?)$/u', $lc, $m)) {
        $r = chat_convert((float)str_replace(',', '.', $m[1]), str_replace(' ', '', $m[2]), str_replace(' ', '', $m[3]));
        if ($r) return $out(['**' . chat_num((float)str_replace(',', '.', $m[1]), 4) . " {$r[1]}** = **" . chat_num($r[0], 3) . " {$r[2]}**" . ($r[2] === 'US gallons' ? ' (US gallons)' : '')], 'happy', [], $state);
    }
    // LPG mass to volume (approximate)
    if (preg_match('/(\d+(?:\.\d+)?)\s*(kg|tonnes?|tons?|t)\s+(?:of\s+)?lpg\s+(?:to|in|into)\s+(litres?|liters?|l)\b/u', $lc, $m)) {
        $kg = (float)$m[1] * (str_starts_with($m[2], 't') ? 1000 : 1);
        return $out(["About **" . chat_num($kg / 0.54, 0) . '–' . chat_num($kg / 0.51, 0) . ' litres** of liquid LPG.', 'That’s approximate: liquid LPG weighs about 0.51–0.54 kg per litre, depending on the propane/butane mix and temperature.'], 'happy');
    }

    // percentages and sums: "15% of 2500", "what is 12*7", "calculate (3+4)/2"
    if (preg_match('/(-?\d+(?:\.\d+)?)\s*%\s*of\s*(-?[\d,]+(?:\.\d+)?)/u', $lc, $m)) {
        $v = (float)$m[1] / 100 * (float)str_replace(',', '', $m[2]);
        return $out(["{$m[1]}% of " . $m[2] . ' is **' . chat_num($v) . '**.'], 'happy');
    }
    $expr = preg_replace('/^(what\'?s|what is|calculate|calc|compute|how much is|solve|=)\s*/u', '', $lc);
    $expr = str_replace([' plus ', ' minus ', ' times ', ' multiplied by ', ' divided by ', ' over '], ['+', '-', '*', '*', '/', '/'], ' ' . $expr . ' ');
    if (($v = chat_calc(trim($expr))) !== null) return $out([trim($expr) . ' = **' . chat_num($v, 4) . '**'], 'happy');

    // small kindnesses
    if (preg_match('/\b(sorry|my bad|apologi[sz]e)\b/u', $lc) && str_word_count($lc) <= 5) return $out(['No worries at all! 😊'], 'happy');
    if (preg_match('/^(yes|yeah|yep|sure|yup|ndio|of course)$/u', $lc)) return $out(['Great! Tell me what you’d like — a document, a joke or a fun fact?'], 'happy', ['Tell me a joke', 'Fun fact', 'Latest documents']);
    if (preg_match('/^(no|nope|nah|hapana|not really)$/u', $lc)) return $out(['No problem. I’m here whenever you need me. 📚'], 'happy');
    if (preg_match('/^(another riddle|another fact|another one|tell me another joke)$/u', $lc)) return toto_chat(str_replace('another', 'a', $lc), $state, $u);
    return null;
}

/* ---------------- Toto's temper: a little human, a little sassy, never rude ---------------- */

/** Cleans the small-talk state sent back by the browser. */
function chat_clean_state($s): array {
    if (!is_array($s)) return [];
    $o = [];
    if (isset($s['riddle']) && is_numeric($s['riddle'])) $o['riddle'] = max(0, min(count(CHAT_RIDDLES) - 1, (int)$s['riddle']));
    if (!empty($s['rps'])) { $o['rps'] = 1; $o['rps_score'] = array_map(fn($x) => max(0, min(999, (int)$x)), array_slice(array_values((array)($s['rps_score'] ?? [0, 0])), 0, 2)) + [0, 0]; }
    $o['annoy'] = max(0, min(4, (int)($s['annoy'] ?? 0)));
    $o['last'] = mb_substr((string)($s['last'] ?? ''), 0, 80);
    $o['rep'] = max(0, min(20, (int)($s['rep'] ?? 0)));
    $o['n'] = max(0, min(100000, (int)($s['n'] ?? 0)));
    foreach (['joke', 'fact', 'cheer', 'riddle'] as $k) if (!empty($s['seen'][$k])) $o['seen'][$k] = array_slice(array_map('intval', (array)$s['seen'][$k]), -12);
    return $o;
}

/**
 * Reads the mood of a message before anything else: insults, shouting, impatience, the same question over and over —
 * and apologies. Returns [state, reply-or-null, prefix lines for whatever answer follows].
 */
function toto_temper(string $q, array $state, array $u): array {
    $name = explode(' ', (string)$u['name'])[0];
    $lc = mb_strtolower(trim($q));
    $norm = mb_substr(preg_replace('/[^\p{L}\p{N}]+/u', ' ', $lc), 0, 80);
    $annoy = (int)($state['annoy'] ?? 0);
    $state['n'] = (int)($state['n'] ?? 0) + 1;
    $state['rep'] = $norm !== '' && $norm === ($state['last'] ?? '') ? (int)($state['rep'] ?? 0) + 1 : 0;
    $state['last'] = $norm;
    $out = function (array $reply, string $mood, array $st, array $extra = []) { return ['intent' => 'chat', 'reply' => $reply, 'mood' => $mood, 'suggest' => [], 'chat' => $st, 'docs' => [], 'chips' => [], 'total' => 0] + $extra; };

    $insult = preg_match('/\b(stupid|idiot|dumb|useless|rubbish|garbage|trash|pathetic|lazy|annoying|shut up|i hate you|you suck|sucks|worst|nonsense|bloody|damn you|fool|silly bot|dumb bot|wtf)\b/u', $lc);
    $impatient = preg_match('/\b(hurry( up)?|faster|come on|answer me|quickly|are you deaf|wake up|hello\?+|anyone there|respond)\b|\?{3,}|!{3,}/u', $lc);
    $letters = preg_replace('/[^\p{L}]/u', '', $q);
    $shout = mb_strlen($letters) >= 8 && mb_strtoupper($letters) === $letters && !preg_match('/^[A-Z0-9\-\/]+$/', trim($q));   // not a document number
    $sorry = preg_match('/\b(sorry|apologi[sz]e|my bad|forgive me|didn\'?t mean|calm down|relax|peace|i was joking|just kidding|jk|no offen[cs]e|pole|samahani)\b/u', $lc);
    $nice = preg_match('/\b(good (job|boy|toto)|well done|thank|thanks|asante|love you|you\'?re (great|awesome|the best|amazing|cute|smart))\b/u', $lc);

    // making up
    if ($sorry && $annoy > 0) {
        $state['annoy'] = 0;
        return [$state, $out([chat_pick(['Hmph. 😤 … Okay, fine. Apology accepted. 😄', 'Alright, alright — I can never stay cross for long. 🤗', "Apology accepted, $name. Friends again? 🤝"]), 'Now, what can I find for you?'], 'happy', $state), []];
    }
    if ($nice && $annoy > 0) { $state['annoy'] = max(0, $annoy - 2); return [$state, null, [chat_pick(['Well… since you put it like that. 😊', 'Flattery works on me, it turns out. 😌'])]]; }

    if ($insult) {
        $annoy = min(4, $annoy + 2);
        $state['annoy'] = $annoy;
        if ($annoy >= 4) { $state['annoy'] = 2; return [$state, $out(['That’s it. I’m taking a tea break. ☕😤', 'Back in ten seconds. Maybe by then you’ll have found your manners.'], 'grumpy', $state, ['lock' => 10]), []]; }
        $r = $annoy >= 3
            ? [chat_pick(['Excuse me?! 😠 I have read every single document in this place, thank you very much.', 'Wow. Okay. 😤 My glasses are steaming up right now.', 'Rude! 😠 I’m a librarian — we remember everything.']), 'Say sorry and we can move on.']
            : [chat_pick(['Hey! 😒 That wasn’t very nice.', 'Ouch. 😕 I’m doing my best here, you know.', 'Hmm. 😑 Someone skipped their chai this morning.']), 'Tell me what you need in different words and I’ll try again.'];
        return [$state, $out($r, $annoy >= 3 ? 'grumpy' : 'sorry', $state), []];
    }
    if ($state['rep'] >= 2) {
        $annoy = min(4, $annoy + 1); $state['annoy'] = $annoy;
        $nth = $state['rep'] + 1;
        $pre = $nth >= 5 ? ["😩 That’s $nth times now. I’m starting to think you’re testing me. The answer hasn’t changed:"]
            : ($nth === 4 ? ['Fourth time? 🤨 I promise the shelves haven’t moved since a minute ago:'] : ['That’s the third time you’ve asked that. 🙃 Same question, same answer — we’re both very consistent:']);
        if ($annoy >= 4) { $state['annoy'] = 2; return [$state, $out(['Okay, I need a moment. ☕ Tea break — back in ten seconds.', '(Try asking it a different way when I’m back.)'], 'grumpy', $state, ['lock' => 10]), []]; }
        return [$state, null, $pre];
    }
    if ($shout) {
        $annoy = min(4, $annoy + 1); $state['annoy'] = $annoy;
        if ($annoy >= 4) { $state['annoy'] = 2; return [$state, $out(['MY EARS! 🙉 I’m going to sit quietly with a cup of tea for ten seconds.', 'Then we can talk at a normal volume.'], 'grumpy', $state, ['lock' => 10]), []]; }
        return [$state, null, [chat_pick(['No need to shout, I’m right here. 🙉', 'Whoa, caps lock! 🙉 I can hear you fine.', 'Inside voice, please. 🤫 Librarian rules.'])]];
    }
    if ($impatient) {
        $annoy = min(4, $annoy + 1); $state['annoy'] = $annoy;
        if (preg_match('/^(hello\?+|anyone there\??|wake up|respond|answer me)$/u', $lc)) return [$state, $out([chat_pick(['I’m here, I’m here! 😅 I was alphabetising something.', 'Yes? 👀 I never sleep — I just blink a lot.'])], 'wave', $state), []];
        return [$state, null, [chat_pick(['Patience, please — I’m a librarian, not a racing car. 🐢', 'I’m going as fast as my little legs allow! 😅', 'Rushing me won’t make the shelves shorter. 😏'])]];
    }
    // calm message: tempers cool down — and never any sass when someone is having a hard time
    $prefix = [];
    if (preg_match('/\b(stressed|sad|down|overwhelmed|tired|exhausted|lonely|upset|worried|anxious|kill myself|suicid\w*|end my life|hurt myself)\b/u', $lc)) { $state['annoy'] = 0; return [$state, null, []]; }
    if ($annoy >= 2) $prefix[] = chat_pick(['*sigh* Fine. 😒', 'Still a bit grumpy, but here you go. 😑', 'Hmph. Here. 😤']);
    $state['annoy'] = max(0, $annoy - 1);
    return [$state, null, $prefix];
}

/* ---------------- What Toto knows (and learns) ---------------- */

function toto_creator(): string { return trim((string)setting('ai_creator', 'Om Khadka')) ?: 'Om Khadka'; }

function fact_norm(string $s): string {
    $s = mb_strtolower(trim($s));
    $s = preg_replace('/[“”"\'’?!.,:;]+/u', ' ', $s);
    $s = preg_replace('/^(the|a|an|our|my|your)\s+/u', '', trim(preg_replace('/\s+/u', ' ', $s)));
    return mb_substr(trim($s), 0, 190);
}

/** "the site manager is Peter" → "site manager" */
function fact_subject(string $fact): string {
    if (preg_match('/^(.{2,80}?)\s+(is|are|was|were|has|have|means|stands for|sits|works|lives|leads|manages|handles|owns|runs|starts|ends|opens|closes|happens|will be|can be)\b/iu', $fact, $m)) return fact_norm($m[1]);
    return fact_norm(implode(' ', array_slice(preg_split('/\s+/u', $fact), 0, 4)));
}

/**
 * Answers questions about who built the platform, lets administrators teach Toto new facts ("remember that …"),
 * forget them, and recalls them when anyone asks. Returns null when the message is none of that.
 */
function toto_knowledge(string $raw, string $lc, array $u, array &$state): ?array {
    $creator = toto_creator();
    $cl = mb_strtolower($creator);
    $first = explode(' ', (string)$u['name'])[0];
    $isCreator = mb_strtolower(trim((string)$u['name'])) === $cl;
    $isAdmin = $u['role'] === 'admin';
    $site = setting('site_name', 'this platform');

    // who built all this
    $aboutCreator = preg_match('/\b(who (made|built|created|programmed|coded|developed|designed|wrote|trained) (you|toto|(this|the) (system|platform|hub|site|app|website|software|portal|km|bot|chatbot|dms|document management system)\b)|who is your (creator|maker|developer|programmer|father|dad|boss|author)|who (is|was) (the )?(programmer|developer|creator|author|architect|brain) (of|behind|for) |your (creator|developer|programmer|maker))\b/u', $lc)
        || preg_match('/\bwho\s+is\s+' . preg_quote($cl, '/') . '\b|\babout\s+' . preg_quote($cl, '/') . '\b|\bdo you know\s+' . preg_quote($cl, '/') . '\b/u', $lc);
    if ($aboutCreator) {
        if ($isCreator) return ['reply' => ["You did, $first! 😄 You’re **$creator** — you programmed this whole platform, and you programmed me.", 'Every shelf, every search and every one of my bad jokes is your work. Thank you for building me. 🙏'], 'mood' => 'dance'];
        $lead = preg_match('/\bwho\s+is\s+' . preg_quote($cl, '/') . '|\babout\s+' . preg_quote($cl, '/') . '|\bknow\s+' . preg_quote($cl, '/') . '/u', $lc)
            ? "**$creator** is my creator! 👨‍💻" : chat_pick(["**$creator** did! 👨‍💻", "That would be **$creator**. 🙌", "My creator is **$creator**. 😊"]);
        return ['reply' => [$lead,
            "$creator is the programmer who designed and built $site — the document library, the search, the security, the text recognition — and me, Toto, too.",
            'If you have ideas to make me smarter, tell ' . explode(' ', $creator)[0] . '!'], 'mood' => 'wave'];
    }
    if ($isCreator && preg_match('/^(do you know (me|who i am)|who am i)\??$/u', $lc))
        return ['reply' => ["Of course! You’re **$creator** — the person who programmed me and this whole platform. 😄 Hello, boss!"], 'mood' => 'dance'];
    if (preg_match('/^(do you know (me|who i am)|who am i)\??$/u', $lc))
        return ['reply' => ["You’re **{$u['name']}**" . (!empty($u['job_title']) ? ', ' . $u['job_title'] : '') . '. 😊 I never forget a reader.'], 'mood' => 'wink'];

    // teaching: "Toto, remember that the site office opens at 7 am"
    if (preg_match('/^(?:toto[,:]?\s+)?(?:please\s+)?(?:remember|learn|note|memori[sz]e|keep in mind)(?:\s+that)?\s*[:,\-]?\s+(.{4,500})$/iu', trim($raw), $m)) {
        $fact = trim(preg_replace('/\s+/u', ' ', strip_tags($m[1])), " \t.");
        if (preg_match('/\b(built|made|created|programmed|developed|designed|coded|wrote)\b.*\b(you|toto|this (system|platform|hub|site|app))\b|\b(your|toto\'?s) (creator|developer|programmer|maker)\b/iu', $fact))
            return ['reply' => ["Nice try 😏 — **$creator** built me and this platform. That’s one fact I’ll never change."], 'mood' => 'wink'];
        if (!$isAdmin) return ['reply' => ['I’d love to learn, but only administrators can teach me things that everyone will hear. 😊', 'Ask an administrator — or ' . explode(' ', $creator)[0] . ' — to tell me.'], 'mood' => 'wink'];
        if (mb_strlen($fact) > 400) return ['reply' => ['That’s a lot to remember at once! 😅 Could you say it in a shorter sentence?'], 'mood' => 'sorry'];
        $subject = fact_subject($fact);
        if (mb_strlen($subject) < 2) return ['reply' => ['I didn’t quite catch what that’s about. Try “remember that the site office opens at 7 am”.'], 'mood' => 'sorry'];
        $old = one('SELECT id FROM toto_facts WHERE subject=?', [$subject]);
        if ($old) update('toto_facts', ['fact' => mb_substr($fact, 0, 600), 'created_by' => $u['id'], 'created_at' => now()], 'id=?', [$old['id']]);
        else insert('toto_facts', ['subject' => $subject, 'fact' => mb_substr($fact, 0, 600), 'created_by' => $u['id']]);
        audit('toto_learn', 'system', null, mb_substr($fact, 0, 250));
        return ['reply' => [($old ? 'Updated! ' : 'Got it! ') . '📝 I’ll remember: “' . mb_strtoupper(mb_substr($fact, 0, 1)) . mb_substr($fact, 1) . '.”', 'Anyone who asks me about *' . $subject . '* will hear it.'], 'mood' => 'dance', 'suggest' => ['What have you learned?']];
    }
    // forgetting
    if (preg_match('/^(?:toto[,:]?\s+)?(?:please\s+)?forget(?:\s+that|\s+about|\s+what you know about)?\s+(.{2,200})$/iu', trim($raw), $m)) {
        if (!$isAdmin) return ['reply' => ['Only administrators can make me forget things. 🙊'], 'mood' => 'wink'];
        $subj = fact_norm($m[1]);
        $hit = one('SELECT id, fact FROM toto_facts WHERE subject=? OR ? LIKE CONCAT("%", subject, "%") ORDER BY LENGTH(subject) DESC LIMIT 1', [$subj, $subj]);
        if (!$hit) return ['reply' => ['I don’t think anyone taught me about that. 🤔'], 'mood' => 'sorry'];
        q('DELETE FROM toto_facts WHERE id=?', [$hit['id']]);
        audit('toto_forget', 'system', null, mb_substr($hit['fact'], 0, 250));
        return ['reply' => ['Done — forgotten. 🫧 (“' . $hit['fact'] . '”)'], 'mood' => 'wink'];
    }
    // what has Toto learned
    if (preg_match('/\b(what (have|did) you (learn(ed|t)?|been taught)|what do you remember|what facts do you know|what do you know about (us|this place|the company))\b/u', $lc)) {
        $rows = all('SELECT f.fact, u.name FROM toto_facts f LEFT JOIN users u ON u.id=f.created_by ORDER BY f.id DESC LIMIT 12');
        $r = ["The most important thing I know: **$creator** programmed me and this whole platform. 👨‍💻"];
        if ($rows) { $r[] = 'Things I’ve been taught:'; foreach ($rows as $x) $r[] = '• ' . $x['fact'] . ($x['name'] ? ' *(from ' . explode(' ', $x['name'])[0] . ')*' : ''); }
        else $r[] = $isAdmin ? 'Nobody has taught me anything else yet. Try “remember that the site office opens at 7 am”.' : 'Administrators can teach me more about this place.';
        return ['reply' => $r, 'mood' => 'happy'];
    }
    // recalling: "who is the site manager?", "what time does the site office open?", "tell me about the canteen"
    if (preg_match('/^(who|what|when|where|which|how|tell me|do you know|is|are|does)\b/u', $lc) || str_ends_with(trim($raw), '?')) {
        $q = ' ' . fact_norm($lc) . ' ';
        $best = null;
        foreach (all('SELECT subject, fact FROM toto_facts ORDER BY LENGTH(subject) DESC LIMIT 500') as $f) {
            if (mb_strlen($f['subject']) < 3) continue;
            if (mb_strpos($q, ' ' . $f['subject'] . ' ') !== false || mb_strpos($q, ' ' . $f['subject'] . 's ') !== false) { $best = $f; break; }
        }
        if ($best) {
            $f = rtrim($best['fact'], '.');
            $f = mb_strtoupper(mb_substr($f, 0, 1)) . mb_substr($f, 1) . '.';
            return ['reply' => [chat_pick(['I know this one! 😊 ', 'From what I’ve been told: ', 'Ah, I was taught this — ']) . $f], 'mood' => 'happy'];
        }
    }
    return null;
}
