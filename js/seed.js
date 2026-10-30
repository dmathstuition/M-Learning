/* M Learning App — built-in sample content (loaded once into IndexedDB on first run).
 * Teachers can add, edit or delete courses/lessons/questions afterwards. */
(function () {
  'use strict';
  const ML = (window.ML = window.ML || {});

  const C = (id, subject, level, title, difficulty, description) => ({ id, subject, level, title, difficulty, description, builtIn: true, createdBy: 'system', createdAt: Date.now() });
  const COURSES = [
    C('c_math_num', 'Mathematics', 'Primary 5', 'Numbers & Operations', 'easy', 'Place value, multiplication and division strategies, and order of operations.'),
    C('c_math_frac', 'Mathematics', 'Primary 6', 'Fractions, Decimals & Percentages', 'medium', 'Work confidently with parts of a whole and convert between forms.'),
    C('c_math_alg', 'Mathematics', 'JSS 1', 'Algebra Basics', 'medium', 'Letters for numbers, simplifying expressions and solving simple equations.'),
    C('c_math_geo', 'Mathematics', 'JSS 2', 'Geometry & Mensuration', 'medium', 'Angles, perimeter and area of common shapes.'),
    C('c_eng_gram', 'English', 'Primary 5', 'Grammar Foundations', 'easy', 'Parts of speech and building correct sentences.'),
    C('c_eng_vocab', 'English', 'Primary 6', 'Vocabulary & Spelling', 'easy', 'Synonyms, antonyms and spelling rules that stick.'),
    C('c_eng_read', 'English', 'JSS 1', 'Reading Comprehension', 'medium', 'Find main ideas, details and meaning in a passage.'),
    C('c_eng_punc', 'English', 'JSS 1', 'Punctuation', 'easy', 'Full stops, commas, apostrophes and question marks used correctly.'),
    C('c_sci_living', 'Basic Science', 'JSS 1', 'Living Things & Cells', 'easy', 'What makes something alive, and the cell — the building block of life.'),
    C('c_sci_matter', 'Basic Science', 'JSS 1', 'Matter & Energy', 'medium', 'States of matter and the forms of energy around us.'),
    C('c_sci_env', 'Basic Science', 'JSS 2', 'Acids, Bases & Our Environment', 'medium', 'Everyday acids and bases, and caring for the environment.'),
    C('c_cs_intro', 'Computer Studies', 'JSS 1', 'Introduction to Computers', 'easy', 'What a computer is, what it does, and how we use it safely.'),
  ];

  let order = 0;
  const L = (id, courseId, title, topic, difficulty, minutes, body, examples) => {
    const c = COURSES.find((x) => x.id === courseId);
    return { id, courseId, subject: c.subject, level: c.level, title, topic, difficulty, minutes, order: order++, body, examples: examples || [], builtIn: true, createdAt: Date.now() };
  };
  const E = (problem, steps, answer) => ({ problem, steps, answer });

  const LESSONS = [
    // ---------------- Mathematics ----------------
    L('l_math_pv', 'c_math_num', 'Place Value', 'Place Value', 'easy', 10,
`## What is place value?
The value of a digit depends on its position in a number. In 4,352 the 4 is worth 4,000 because it is in the thousands place.

- Ones, tens, hundreds, thousands, ten-thousands …
- Each place is 10 times the place to its right.

> Read big numbers in groups of three from the right: 3,405,120 is "three million, four hundred and five thousand, one hundred and twenty".`,
      [E('What is the value of 7 in 57,312?', ['Count places from the right: 2 is ones, 1 tens, 3 hundreds, 7 thousands.', 'So 7 is worth 7 × 1,000.'], '7,000'),
       E('Write 30,000 + 400 + 6 as a number.', ['Put each part in its place: 3 ten-thousands, 0 thousands, 4 hundreds, 0 tens, 6 ones.'], '30,406')]),
    L('l_math_mul', 'c_math_num', 'Multiplication Strategies', 'Multiplication', 'easy', 12,
`## Multiplication is repeated addition
4 × 6 means four groups of six: 6 + 6 + 6 + 6 = 24.

## Handy strategies
- Doubling: 8 × 7 is double 4 × 7 = double 28 = 56.
- Splitting: 6 × 14 = 6 × 10 + 6 × 4 = 60 + 24 = 84.
- Order does not matter: 3 × 9 = 9 × 3.

> Learn your times tables up to 12 × 12 — they make every other topic faster.`,
      [E('Work out 9 × 13.', ['Split 13 into 10 + 3.', '9 × 10 = 90 and 9 × 3 = 27.', 'Add: 90 + 27.'], '117')]),
    L('l_math_bodmas', 'c_math_num', 'Order of Operations (BODMAS)', 'Order of Operations', 'medium', 12,
`## BODMAS
When a calculation has several operations, do them in this order:
- Brackets
- Orders (powers and roots)
- Division and Multiplication (left to right)
- Addition and Subtraction (left to right)

> Division and multiplication have the same rank — work left to right. The same is true for addition and subtraction.`,
      [E('Calculate 3 + 4 × 2.', ['Multiplication first: 4 × 2 = 8.', 'Then add: 3 + 8.'], '11'),
       E('Calculate (6 + 2) × 5 − 4.', ['Brackets: 6 + 2 = 8.', 'Multiply: 8 × 5 = 40.', 'Subtract: 40 − 4.'], '36')]),
    L('l_math_frac', 'c_math_frac', 'Understanding Fractions', 'Fractions', 'medium', 15,
`## Parts of a whole
A fraction like 3/4 means 3 parts out of 4 equal parts. The top number is the numerator; the bottom is the denominator.

## Equivalent fractions
Multiply or divide top and bottom by the same number: 1/2 = 2/4 = 4/8.

## Adding fractions
- Same denominator: add the numerators. 2/7 + 3/7 = 5/7.
- Different denominators: first make them the same using the lowest common multiple.

> Always simplify your final answer: 6/8 = 3/4.`,
      [E('Add 1/3 + 1/4.', ['LCM of 3 and 4 is 12.', '1/3 = 4/12 and 1/4 = 3/12.', '4/12 + 3/12 = 7/12.'], '7/12'),
       E('Simplify 12/18.', ['The highest common factor of 12 and 18 is 6.', '12 ÷ 6 = 2, 18 ÷ 6 = 3.'], '2/3')]),
    L('l_math_pct', 'c_math_frac', 'Decimals & Percentages', 'Percentages', 'medium', 12,
`## Percent means "out of 100"
25% = 25/100 = 0.25.

- Fraction → percentage: multiply by 100. 3/5 × 100 = 60%.
- Percentage of an amount: 20% of 150 = 0.2 × 150 = 30.

> To find 10%, divide by 10. Then build other percentages from it: 30% = 3 × 10%.`,
      [E('Find 15% of 80.', ['10% of 80 = 8.', '5% is half of 10% = 4.', '15% = 8 + 4.'], '12')]),
    L('l_math_expr', 'c_math_alg', 'Algebraic Expressions', 'Algebraic Expressions', 'medium', 12,
`## Letters stand for numbers
In 3x + 2, x is a variable. 3x means 3 × x.

## Like terms
Only like terms can be added: 4a + 3a = 7a, but 4a + 3b stays as it is.

> Substitution: if x = 5, then 3x + 2 = 3 × 5 + 2 = 17.`,
      [E('Simplify 5y + 2x − 3y + 4x.', ['Group like terms: (5y − 3y) + (2x + 4x).', '2y + 6x.'], '6x + 2y')]),
    L('l_math_eq', 'c_math_alg', 'Solving Linear Equations', 'Linear Equations', 'medium', 15,
`## Keep the balance
An equation is like a balanced scale. Whatever you do to one side, do to the other.

- Undo addition by subtracting; undo multiplication by dividing.
- Aim to get the variable alone on one side.

> Check your answer by substituting it back into the original equation.`,
      [E('Solve 2x + 7 = 19.', ['Subtract 7 from both sides: 2x = 12.', 'Divide both sides by 2.'], 'x = 6'),
       E('Solve x/3 − 2 = 4.', ['Add 2 to both sides: x/3 = 6.', 'Multiply both sides by 3.'], 'x = 18')]),
    L('l_math_area', 'c_math_geo', 'Perimeter & Area', 'Perimeter and Area', 'medium', 15,
`## Perimeter
The distance around a shape. Rectangle: P = 2(l + w).

## Area
The space inside a shape, measured in square units.
- Rectangle: A = l × w
- Triangle: A = ½ × base × height
- Circle: A = πr²

> Perimeter is measured in cm or m; area in cm² or m². Don't mix them up.`,
      [E('A rectangle is 8 cm long and 5 cm wide. Find its area and perimeter.', ['Area = 8 × 5 = 40 cm².', 'Perimeter = 2(8 + 5) = 26 cm.'], '40 cm² and 26 cm'),
       E('Find the area of a triangle with base 10 m and height 6 m.', ['A = ½ × 10 × 6.'], '30 m²')]),
    L('l_math_ang', 'c_math_geo', 'Angles', 'Angles', 'medium', 10,
`## Types of angles
- Acute: less than 90°
- Right: exactly 90°
- Obtuse: between 90° and 180°
- Reflex: between 180° and 360°

## Angle facts
- Angles on a straight line add up to 180°.
- Angles in a triangle add up to 180°.
- Angles around a point add up to 360°.`,
      [E('Two angles of a triangle are 50° and 60°. Find the third.', ['Angles in a triangle sum to 180°.', '180 − 50 − 60.'], '70°')]),
    // ---------------- English ----------------
    L('l_eng_pos', 'c_eng_gram', 'Parts of Speech', 'Parts of Speech', 'easy', 12,
`## The eight parts of speech
- Noun: names a person, place, animal or thing (Ada, Lagos, goat, book).
- Pronoun: replaces a noun (she, it, they).
- Verb: an action or state (run, is, think).
- Adjective: describes a noun (tall, blue).
- Adverb: describes a verb, adjective or adverb (quickly, very).
- Preposition: shows position or relationship (on, under, between).
- Conjunction: joins words or clauses (and, but, because).
- Interjection: shows strong feeling (Wow! Oh!).

> Ask what job the word is doing in the sentence — the same word can be a noun in one sentence and a verb in another.`,
      [E('Identify the adverb: "The children sang loudly."', ['"sang" is the verb.', 'Which word tells us how they sang?'], 'loudly')]),
    L('l_eng_tense', 'c_eng_gram', 'Verb Tenses', 'Tenses', 'easy', 10,
`## Past, present and future
- Past: I walked to school.
- Present: I walk to school.
- Future: I will walk to school.

## Irregular verbs
Some verbs change completely in the past tense: go → went, eat → ate, see → saw.

> Keep the tense consistent within a paragraph unless the time really changes.`,
      [E('Change to the past tense: "She writes a letter."', ['"writes" is present tense.', 'The past tense of write is wrote.'], 'She wrote a letter.')]),
    L('l_eng_sva', 'c_eng_gram', 'Subject–Verb Agreement', 'Subject-Verb Agreement', 'medium', 10,
`## Singular subject → singular verb
- The boy runs. The boys run.
- Each of the students has a book.
- Neither Tola nor Emeka is late.

> Words between the subject and verb don't change the agreement: "The box of pencils IS on the table."`,
      [E('Choose the correct verb: "The list of names (is/are) long."', ['The subject is "list" (singular), not "names".'], 'is')]),
    L('l_eng_syn', 'c_eng_vocab', 'Synonyms & Antonyms', 'Vocabulary', 'easy', 10,
`## Synonyms
Words with similar meanings: big – large, happy – joyful.

## Antonyms
Words with opposite meanings: hot – cold, ancient – modern.

> Using synonyms makes your writing more interesting. Instead of repeating "good", try excellent, pleasant or helpful.`,
      [E('Give an antonym of "generous".', ['Generous means willing to give.', 'The opposite is unwilling to give.'], 'mean / selfish / stingy')]),
    L('l_eng_spell', 'c_eng_vocab', 'Spelling Rules', 'Spelling', 'easy', 10,
`## Useful rules
- "i before e except after c": believe, receive (but watch for exceptions like "science").
- Words ending in consonant + y: change y to i before -es/-ed: carry → carries, carried.
- Doubling: short vowel + one consonant → double before -ing: run → running, swim → swimming.

> Commonly misspelt words: necessary, separate, definitely, environment, government.`,
      [E('Add -ing to "begin".', ['Stress is on the last syllable, short vowel, one final consonant.', 'Double the n.'], 'beginning')]),
    L('l_eng_comp', 'c_eng_read', 'Reading for Meaning', 'Reading Comprehension', 'medium', 15,
`## Steps for comprehension
- Skim the passage first to get the main idea.
- Read the questions, then scan the passage for key words.
- Answer in your own words unless asked to quote.

## Sample passage
Adaeze woke before sunrise. She fed the chickens, swept the compound and still reached school before the bell. Her teacher praised her for never being late, even though she lived the farthest away.

> Main idea vs detail: the main idea is what the whole passage is about; details support it.`,
      [E('What is the main idea of the passage about Adaeze?', ['The passage lists her chores and that she is still on time.', 'The teacher praises her punctuality.'], 'Adaeze is hardworking and always punctual.')]),
    L('l_eng_punc', 'c_eng_punc', 'Using Punctuation Correctly', 'Punctuation', 'easy', 12,
`## Common marks
- Full stop (.) ends a statement.
- Question mark (?) ends a direct question.
- Comma (,) separates items in a list or parts of a sentence.
- Apostrophe (') shows possession (Tunde's bag) or a missing letter (don't).
- Exclamation mark (!) shows strong feeling.

> "its" means belonging to it; "it's" means "it is". The dog wagged its tail. It's raining.`,
      [E('Punctuate: "where is amakas pen"', ['It is a question, so it ends with ?', 'The pen belongs to Amaka → Amaka\'s.', 'Start with a capital letter.'], 'Where is Amaka\'s pen?')]),
    // ---------------- Basic Science ----------------
    L('l_sci_living', 'c_sci_living', 'Living and Non-Living Things', 'Living Things', 'easy', 12,
`## Characteristics of living things (MRS NERG)
- Movement
- Respiration
- Sensitivity
- Nutrition
- Excretion
- Reproduction
- Growth

Non-living things (stone, chair, water) do not show all of these characteristics.

> A car moves and uses fuel, but it cannot grow or reproduce — so it is non-living.`,
      [E('Is a seed living or non-living? Explain.', ['A seed can grow into a plant when conditions are right.', 'It carries out slow respiration.'], 'Living (it is dormant, not dead).')]),
    L('l_sci_cell', 'c_sci_living', 'The Cell', 'Cells', 'medium', 15,
`## Building blocks of life
All living things are made of cells.

## Parts of a cell
- Nucleus: controls the cell's activities.
- Cytoplasm: jelly-like substance where reactions happen.
- Cell membrane: controls what enters and leaves.
- Plant cells also have a cell wall, a large vacuole and chloroplasts.

> Chloroplasts contain chlorophyll, which traps sunlight for photosynthesis.`,
      [E('Name two structures found in plant cells but not in animal cells.', ['Compare the two lists of parts.'], 'Cell wall and chloroplasts')]),
    L('l_sci_matter', 'c_sci_matter', 'States of Matter', 'Matter', 'easy', 12,
`## Matter is anything that has mass and occupies space
- Solid: fixed shape and volume (ice, wood).
- Liquid: fixed volume, takes the shape of its container (water, oil).
- Gas: no fixed shape or volume (air, steam).

## Changes of state
- Melting: solid → liquid; Freezing: liquid → solid.
- Evaporation/boiling: liquid → gas; Condensation: gas → liquid.

> Water boils at 100 °C and freezes at 0 °C at sea level.`,
      [E('What change of state happens when water droplets form on a cold bottle?', ['Water vapour in the air touches the cold surface.', 'Gas turns into liquid.'], 'Condensation')]),
    L('l_sci_energy', 'c_sci_matter', 'Forms of Energy', 'Energy', 'medium', 12,
`## Energy is the ability to do work
- Heat (thermal), light, sound, electrical, chemical, mechanical (kinetic and potential).

## Energy changes form
- A torch: chemical (battery) → electrical → light.
- A kettle: electrical → heat.

> Energy cannot be created or destroyed — only changed from one form to another.`,
      [E('What energy change happens in a radio?', ['A radio uses electricity.', 'It produces sound.'], 'Electrical → sound')]),
    L('l_sci_acid', 'c_sci_env', 'Acids and Bases', 'Acids and Bases', 'medium', 15,
`## Acids
Sour taste, turn blue litmus red. Examples: lemon juice, vinegar.

## Bases (alkalis)
Bitter, soapy feel, turn red litmus blue. Examples: soap, baking soda solution.

## The pH scale
- pH below 7: acidic
- pH 7: neutral (pure water)
- pH above 7: basic

> Never taste or touch unknown chemicals in the lab — use indicators instead.`,
      [E('A solution turns red litmus paper blue. Is it acidic or basic?', ['Bases turn red litmus blue.'], 'Basic (alkaline)')]),
    L('l_sci_env', 'c_sci_env', 'Our Environment', 'Environment', 'easy', 10,
`## The environment is everything around us
It includes living parts (plants, animals) and non-living parts (air, water, soil).

## Problems and solutions
- Pollution (air, water, land) → proper waste disposal, recycling.
- Deforestation → planting trees.
- Erosion → planting cover crops, building drainage.

> Reduce, Reuse, Recycle.`,
      [E('Give one way to reduce land pollution in your school.', ['Think about waste.'], 'Use bins and sort waste for recycling.')]),
    // ---------------- Computer Studies ----------------
    L('l_cs_intro', 'c_cs_intro', 'What is a Computer?', 'Introduction to Computers', 'easy', 10,
`## Definition
A computer is an electronic machine that accepts data (input), processes it, stores it and produces information (output).

## The IPO cycle
- Input: keyboard, mouse, scanner
- Process: CPU (central processing unit)
- Output: monitor, printer, speakers
- Storage: hard disk, flash drive

> Data is raw facts; information is processed data that has meaning.`,
      [E('Classify: keyboard, printer, CPU.', ['Which accepts data, which processes, which shows results?'], 'Input, output, processing')]),
    L('l_cs_hw', 'c_cs_intro', 'Hardware and Software', 'Hardware and Software', 'easy', 12,
`## Hardware
The physical parts you can touch: monitor, keyboard, system unit.

## Software
Programs that tell the hardware what to do.
- System software: operating systems like Windows, Linux, Android.
- Application software: word processors, games, browsers.

> Online safety: never share your password, and tell an adult about anything online that makes you uncomfortable.`,
      [E('Is a web browser hardware or software? What kind?', ['You cannot touch a browser.', 'It helps the user do a task.'], 'Software — application software')]),
  ];

  // Question bank (validated through the same importer used by teachers).
  const M = 'Mathematics', EN = 'English', S = 'Basic Science', CS = 'Computer Studies';
  const q = (type, text, options, answer, explanation, subject, level, topic, difficulty, marks) => ({ type, text, options, answer, explanation, subject, level, topic, difficulty, marks: marks || 1 });
  const RAW_QUESTIONS = [
    q('mcq', 'What is the value of the digit 6 in 46,215?', ['6', '600', '6,000', '60,000'], 'C', 'Counting from the right: 5 ones, 1 ten, 2 hundreds, 6 thousands → 6,000.', M, 'Primary 5', 'Place Value', 'easy'),
    q('mcq', 'Which number is "forty thousand and twelve"?', ['4,012', '40,012', '40,120', '400,012'], 'B', '40,000 + 12 = 40,012.', M, 'Primary 5', 'Place Value', 'easy'),
    q('mcq', 'What is 12 × 11?', ['121', '132', '122', '144'], 'B', '12 × 11 = 12 × 10 + 12 = 132.', M, 'Primary 5', 'Multiplication', 'easy'),
    q('fill', '8 × 7 = ___', [], '56', 'Double 4 × 7 = 28 → 56.', M, 'Primary 5', 'Multiplication', 'easy'),
    q('mcq', 'Calculate 5 + 3 × 4.', ['32', '17', '20', '12'], 'B', 'Multiply first: 3 × 4 = 12, then 5 + 12 = 17.', M, 'Primary 5', 'Order of Operations', 'medium'),
    q('short', 'Calculate (10 − 4) × 3 + 2.', [], '20', 'Brackets: 6. Multiply: 18. Add 2: 20.', M, 'Primary 5', 'Order of Operations', 'medium', 2),
    q('tf', 'In BODMAS, addition is always done before subtraction.', [], 'false', 'Addition and subtraction have equal rank; work left to right.', M, 'Primary 5', 'Order of Operations', 'medium'),
    q('mcq', 'Which fraction is equivalent to 3/4?', ['6/8', '4/3', '3/8', '9/16'], 'A', 'Multiply top and bottom by 2: 3/4 = 6/8.', M, 'Primary 6', 'Fractions', 'easy'),
    q('mcq', 'What is 1/2 + 1/3?', ['2/5', '5/6', '1/6', '2/6'], 'B', 'LCM is 6: 3/6 + 2/6 = 5/6.', M, 'Primary 6', 'Fractions', 'medium'),
    q('fill', 'Simplify 10/15 = ___ (write as a fraction)', [], '2/3', 'Divide top and bottom by 5.', M, 'Primary 6', 'Fractions', 'medium'),
    q('mcq', 'What is 25% of 200?', ['25', '40', '50', '75'], 'C', '25% = 1/4, and 200 ÷ 4 = 50.', M, 'Primary 6', 'Percentages', 'easy'),
    q('short', 'Write 3/5 as a percentage (number only).', [], '60|60%', '3/5 × 100 = 60%.', M, 'Primary 6', 'Percentages', 'medium'),
    q('mcq', 'Simplify 4a + 3b − a + 2b.', ['3a + 5b', '5a + 5b', '3a + b', '7ab'], 'A', '(4a − a) + (3b + 2b) = 3a + 5b.', M, 'JSS 1', 'Algebraic Expressions', 'medium'),
    q('mcq', 'If x = 4, what is 3x − 5?', ['7', '12', '17', '2'], 'A', '3 × 4 − 5 = 12 − 5 = 7.', M, 'JSS 1', 'Algebraic Expressions', 'easy'),
    q('short', 'Solve for x: 2x + 7 = 19', [], '6|x=6|x = 6', 'Subtract 7: 2x = 12. Divide by 2: x = 6.', M, 'JSS 1', 'Linear Equations', 'medium', 2),
    q('mcq', 'Solve: x − 9 = 4', ['5', '13', '−5', '36'], 'B', 'Add 9 to both sides: x = 13.', M, 'JSS 1', 'Linear Equations', 'easy'),
    q('fill', 'If 5y = 35, then y = ___', [], '7', 'Divide both sides by 5.', M, 'JSS 1', 'Linear Equations', 'easy'),
    q('mcq', 'What is the area of a rectangle 9 cm by 4 cm?', ['13 cm²', '26 cm²', '36 cm²', '36 cm'], 'C', 'Area = length × width = 36 cm² (square units).', M, 'JSS 2', 'Perimeter and Area', 'easy'),
    q('short', 'Find the perimeter (in cm) of a square with side 7 cm.', [], '28|28 cm|28cm', 'Perimeter = 4 × 7 = 28 cm.', M, 'JSS 2', 'Perimeter and Area', 'easy'),
    q('mcq', 'An angle of 120° is…', ['acute', 'right', 'obtuse', 'reflex'], 'C', 'Between 90° and 180° → obtuse.', M, 'JSS 2', 'Angles', 'easy'),
    q('fill', 'Two angles of a triangle are 40° and 75°. The third angle is ___ degrees.', [], '65|65°', '180 − 40 − 75 = 65.', M, 'JSS 2', 'Angles', 'medium'),
    q('tf', 'Angles on a straight line add up to 360°.', [], 'false', 'They add up to 180°. Angles around a point add up to 360°.', M, 'JSS 2', 'Angles', 'easy'),

    q('mcq', 'Which word is a noun? "The happy girl sang beautifully."', ['happy', 'girl', 'sang', 'beautifully'], 'B', '"girl" names a person.', EN, 'Primary 5', 'Parts of Speech', 'easy'),
    q('mcq', 'Identify the adjective: "She wore a red dress."', ['She', 'wore', 'red', 'dress'], 'C', '"red" describes the noun "dress".', EN, 'Primary 5', 'Parts of Speech', 'easy'),
    q('mcq', 'Which word is a conjunction?', ['quickly', 'because', 'under', 'wow'], 'B', 'Conjunctions join clauses — "because".', EN, 'Primary 5', 'Parts of Speech', 'easy'),
    q('tf', 'A pronoun is used in place of a noun.', [], 'true', 'He, she, it, they replace nouns.', EN, 'Primary 5', 'Parts of Speech', 'easy'),
    q('fill', 'The past tense of "go" is ___.', [], 'went', '"go" is irregular: go → went → gone.', EN, 'Primary 5', 'Tenses', 'easy'),
    q('mcq', 'Choose the future tense.', ['I ate rice.', 'I eat rice.', 'I will eat rice.', 'I am eating rice.'], 'C', '"will + verb" shows the future.', EN, 'Primary 5', 'Tenses', 'easy'),
    q('mcq', 'Choose the correct verb: "Each of the boys ___ a ball."', ['have', 'has', 'are having', 'were'], 'B', '"Each" is singular → has.', EN, 'Primary 5', 'Subject-Verb Agreement', 'medium'),
    q('mcq', '"The box of pencils ___ on the table."', ['is', 'are', 'were', 'be'], 'A', 'The subject is "box" (singular).', EN, 'Primary 5', 'Subject-Verb Agreement', 'medium'),
    q('mcq', 'A synonym of "enormous" is…', ['tiny', 'huge', 'quiet', 'early'], 'B', 'Enormous and huge both mean very big.', EN, 'Primary 6', 'Vocabulary', 'easy'),
    q('mcq', 'An antonym of "ancient" is…', ['old', 'modern', 'historic', 'aged'], 'B', 'Ancient means very old; the opposite is modern.', EN, 'Primary 6', 'Vocabulary', 'easy'),
    q('short', 'Give one synonym for "happy".', [], 'glad|joyful|cheerful|delighted|pleased|content|merry', 'Any word with a similar meaning is accepted.', EN, 'Primary 6', 'Vocabulary', 'easy'),
    q('mcq', 'Which word is spelt correctly?', ['recieve', 'receive', 'receeve', 'riceive'], 'B', '"i before e except after c" → receive.', EN, 'Primary 6', 'Spelling', 'easy'),
    q('mcq', 'Which word is spelt correctly?', ['neccessary', 'necesary', 'necessary', 'nesessary'], 'C', 'One c, double s: necessary.', EN, 'Primary 6', 'Spelling', 'medium'),
    q('fill', 'carry + es = ___', [], 'carries', 'Consonant + y → change y to i and add -es.', EN, 'Primary 6', 'Spelling', 'easy'),
    q('mcq', 'In the Adaeze passage, why did the teacher praise her?', ['She was the tallest', 'She was never late', 'She fed the chickens', 'She lived nearby'], 'B', 'The passage says she was praised for never being late.', EN, 'JSS 1', 'Reading Comprehension', 'easy'),
    q('tf', 'The main idea of a passage is the same as one small detail in it.', [], 'false', 'The main idea is what the whole passage is about; details support it.', EN, 'JSS 1', 'Reading Comprehension', 'easy'),
    q('mcq', 'Which sentence is punctuated correctly?', ['its raining today.', "It's raining today.", 'Its raining today', "it's raining today"], 'B', '"It\'s" = it is, and a sentence starts with a capital letter.', EN, 'JSS 1', 'Punctuation', 'easy'),
    q('mcq', 'Which mark ends a direct question?', ['.', ',', '?', '!'], 'C', 'Direct questions end with a question mark.', EN, 'JSS 1', 'Punctuation', 'easy'),
    q('fill', "The bag belonging to Tunde is Tunde___ bag. (write the missing characters)", [], "'s", "Possession of a singular noun: add 's.", EN, 'JSS 1', 'Punctuation', 'medium'),

    q('mcq', 'Which of these is a living thing?', ['Stone', 'Car', 'Mango tree', 'Water'], 'C', 'A mango tree grows, respires and reproduces.', S, 'JSS 1', 'Living Things', 'easy'),
    q('tf', 'A car is a living thing because it moves.', [], 'false', 'Movement alone is not enough; cars cannot grow or reproduce.', S, 'JSS 1', 'Living Things', 'easy'),
    q('fill', 'The process by which plants make food using sunlight is called ___.', [], 'photosynthesis', 'Plants use sunlight, water and carbon dioxide to make glucose.', S, 'JSS 1', 'Living Things', 'medium'),
    q('mcq', 'Which part controls the activities of a cell?', ['Cytoplasm', 'Nucleus', 'Cell wall', 'Vacuole'], 'B', 'The nucleus is the control centre.', S, 'JSS 1', 'Cells', 'easy'),
    q('mcq', 'Which is found in plant cells but NOT animal cells?', ['Nucleus', 'Cytoplasm', 'Cell membrane', 'Chloroplast'], 'D', 'Chloroplasts (with chlorophyll) are found in plant cells.', S, 'JSS 1', 'Cells', 'medium'),
    q('mcq', 'Which state of matter has a fixed volume but no fixed shape?', ['Solid', 'Liquid', 'Gas', 'None'], 'B', 'Liquids take the shape of their container.', S, 'JSS 1', 'Matter', 'easy'),
    q('mcq', 'Water vapour turning into water droplets is called…', ['evaporation', 'melting', 'condensation', 'freezing'], 'C', 'Gas → liquid is condensation.', S, 'JSS 1', 'Matter', 'easy'),
    q('fill', 'Pure water boils at ___ °C at sea level.', [], '100', 'The boiling point of water at sea level is 100 °C.', S, 'JSS 1', 'Matter', 'easy'),
    q('mcq', 'A torch changes chemical energy mainly into…', ['sound energy', 'light energy', 'nuclear energy', 'wind energy'], 'B', 'Battery (chemical) → electrical → light.', S, 'JSS 1', 'Energy', 'medium'),
    q('tf', 'Energy can be created from nothing.', [], 'false', 'Energy is conserved; it only changes form.', S, 'JSS 1', 'Energy', 'medium'),
    q('mcq', 'A substance with pH 3 is…', ['basic', 'neutral', 'acidic', 'salty'], 'C', 'pH below 7 is acidic.', S, 'JSS 2', 'Acids and Bases', 'medium'),
    q('mcq', 'Which turns red litmus paper blue?', ['Vinegar', 'Lemon juice', 'Soap solution', 'Pure water'], 'C', 'Soap is basic; bases turn red litmus blue.', S, 'JSS 2', 'Acids and Bases', 'medium'),
    q('short', 'Give one way to reduce pollution in your community.', [], '', 'Teacher marks: e.g. proper waste disposal, recycling, tree planting.', S, 'JSS 2', 'Environment', 'easy', 2),

    q('mcq', 'Which of these is an input device?', ['Monitor', 'Printer', 'Keyboard', 'Speaker'], 'C', 'A keyboard sends data into the computer.', CS, 'JSS 1', 'Introduction to Computers', 'easy'),
    q('mcq', 'CPU stands for…', ['Central Processing Unit', 'Computer Personal Unit', 'Central Program Utility', 'Control Panel Unit'], 'A', 'The CPU processes data.', CS, 'JSS 1', 'Introduction to Computers', 'easy'),
    q('tf', 'Data is processed information.', [], 'false', 'It is the other way round: information is processed data.', CS, 'JSS 1', 'Introduction to Computers', 'medium'),
    q('mcq', 'Which is an example of system software?', ['A game', 'Windows', 'A word processor', 'A web browser'], 'B', 'Operating systems are system software.', CS, 'JSS 1', 'Hardware and Software', 'easy'),
    q('tf', 'A monitor is hardware.', [], 'true', 'You can touch it — it is a physical part.', CS, 'JSS 1', 'Hardware and Software', 'easy'),
    q('fill', 'Programs that tell a computer what to do are called ___.', [], 'software', 'Software = programs.', CS, 'JSS 1', 'Hardware and Software', 'easy'),
  ];

  async function run() {
    const flag = await ML.db.get('meta', 'seeded');
    if (flag) return false;
    const owner = { id: 'system', role: 'teacher' };
    const questions = [];
    for (const raw of RAW_QUESTIONS) {
      const r = ML.Q.validate(raw, {});
      if (r.errors.length) { console.warn('Seed question skipped:', raw.text, r.errors); continue; }
      questions.push(ML.Q.toRecord(r.q, owner, 'Sample Bank', { practice: true, builtIn: true }));
    }
    const pick = (subject, n) => questions.filter((x) => x.subject === subject && x.type !== 'short').slice(0, n).map((x) => x.id);
    const quiz = (id, title, subject, level, ids, opts) => Object.assign({
      id, title, subject, level, description: '', questionIds: ids, marks: {}, timeLimitMin: 0, feedbackMode: 'immediate', shuffle: false,
      status: 'published', assign: { type: 'all', level: '', studentIds: [] }, dueDate: null, createdBy: 'system', createdAt: Date.now(), publishedAt: Date.now(),
    }, opts || {});
    const sciIds = questions.filter((x) => x.subject === S).map((x) => x.id);
    const quizzes = [
      quiz('qz_math_start', 'Mathematics Starter Quiz', M, 'Primary 5', pick(M, 10), { description: 'Place value, multiplication and BODMAS. Instant feedback after every question.' }),
      quiz('qz_eng_gram', 'English Grammar Challenge', EN, 'Primary 5', pick(EN, 10), { description: 'Timed: 8 minutes. Feedback is shown after you submit.', timeLimitMin: 8, feedbackMode: 'after', shuffle: true }),
      quiz('qz_sci_check', 'Basic Science Check', S, 'JSS 1', sciIds, { description: 'Includes one written answer marked by your teacher.' }),
    ];
    await ML.db.putMany('courses', COURSES);
    await ML.db.putMany('lessons', LESSONS);
    await ML.db.putMany('questions', questions);
    await ML.db.putMany('quizzes', quizzes);
    await ML.db.put('meta', { key: 'seeded', value: Date.now() });
    return true;
  }

  ML.seed = { run, RAW_QUESTIONS };
})();
