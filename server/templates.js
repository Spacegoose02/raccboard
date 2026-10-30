// Built-in board templates. Card `labels` and rule `list`/`value` refer to names in the same template.
const STATUS_LABELS = [
  { name: 'In progress', color: '#3b82f6' },
  { name: 'Cancelled', color: '#ef4444' },
  { name: 'Future', color: '#a855f7' },
  { name: 'Done', color: '#22c55e' },
];

export const BOARD_TEMPLATES = [
  {
    id: 'kanban',
    name: 'Simple Kanban',
    description: 'To do, Doing, Done. Cards moved to Done are marked complete.',
    color: '#3b82f6',
    labels: STATUS_LABELS,
    lists: [{ name: 'To do' }, { name: 'Doing' }, { name: 'Done' }],
    rules: [
      { trigger: 'card_moved', list: 'Done', action: 'complete' },
      { trigger: 'card_moved', list: 'Doing', action: 'join_actor' },
    ],
  },
  {
    id: 'simple',
    name: 'Simple list',
    description: 'Starts empty: add your own sections with +, and simple Markdown cards with checkboxes.',
    color: '#64748b',
    layout: 'simple',
    labels: [],
    lists: [],
  },
  {
    id: 'homeboard',
    name: 'Homeboard',
    description: 'House projects: rooms as lists, projects as cards, materials as checklists.',
    color: '#e0a458',
    labels: [
      { name: 'Planning', color: '#a855f7' },
      { name: 'Buying', color: '#eab308' },
      { name: 'In progress', color: '#3b82f6' },
      { name: 'Done', color: '#22c55e' },
      { name: 'Hire a pro', color: '#ef4444' },
    ],
    lists: [
      { name: 'Ideas', cards: [{ title: 'Project template', template: true, description: 'Copy this card for each new project.\n\n**Budget:** \n**Deadline:** ',
        checklists: [{ title: 'Materials', items: ['Measure', 'Make a shopping list'] }, { title: 'Steps', items: ['Prep', 'Do the work', 'Clean up'] }] }] },
      { name: 'Kitchen', cards: [{ title: 'Re-caulk the sink', labels: ['Planning'], checklists: [{ title: 'Materials', items: ['Silicone caulk', 'Caulk gun', 'Painter\'s tape'] }] }] },
      { name: 'Living room' },
      { name: 'Bathroom' },
      { name: 'Bedrooms' },
      { name: 'Garage' },
      { name: 'Yard', cards: [{ title: 'Spring clean-up', labels: ['Planning'], checklists: [{ title: 'Steps', items: ['Rake leaves', 'Edge the beds', 'Mulch'] }] }] },
      { name: 'Done' },
    ],
    rules: [
      { trigger: 'card_moved', list: 'Done', action: 'complete' },
      { trigger: 'card_moved', list: 'Done', action: 'add_label', value: 'Done' },
    ],
  },
  {
    id: 'weekly',
    name: 'Weekly planner',
    description: 'A list for each day of the week plus a someday list.',
    color: '#06b6d4',
    labels: STATUS_LABELS,
    lists: ['Someday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Weekend', 'Done'].map((name) => ({ name })),
    rules: [{ trigger: 'card_moved', list: 'Done', action: 'complete' }],
  },
  {
    id: 'project',
    name: 'Project tracker',
    description: 'Backlog to release, with Bug/Feature/Urgent labels and a bug report template.',
    color: '#a855f7',
    labels: [
      { name: 'Bug', color: '#ef4444' },
      { name: 'Feature', color: '#22c55e' },
      { name: 'Urgent', color: '#f97316' },
      { name: 'Blocked', color: '#64748b' },
    ],
    lists: [
      { name: 'Backlog', cards: [{ title: 'Bug report', template: true, labels: ['Bug'], description: '**What happened**\n\n**What should happen**\n\n**Steps to reproduce**\n1. ',
        checklists: [{ title: 'Fix', items: ['Reproduce', 'Fix', 'Test', 'Release'] }] }] },
      { name: 'This week' }, { name: 'In progress' }, { name: 'Review' }, { name: 'Done' },
    ],
    rules: [
      { trigger: 'card_moved', list: 'In progress', action: 'join_actor' },
      { trigger: 'card_moved', list: 'Done', action: 'complete' },
      { trigger: 'card_moved', list: 'Done', action: 'remove_label', value: 'Blocked' },
    ],
  },
];
