/**
 * 10 distinct Feishu Bitable marketplace-style templates.
 * Each is described to the agent in natural language (`prompt`); `expect` lists the
 * core fields the replicated table must contain (name + optional select type) so the
 * harness can score how faithfully the agent reproduced it.
 */
export interface ExpectField {
  name: string
  /** 3 = single-select, 4 = multi-select; omit if type doesn't matter */
  select?: 3 | 4
}
export interface TemplateSpec {
  key: string
  label: string
  table: string
  prompt: string
  expect: ExpectField[]
}

export const TEMPLATES: TemplateSpec[] = [
  {
    key: 'project', label: '项目任务管理', table: '任务',
    prompt: '在当前多维表格里创建一个「项目任务」数据表，字段包括：任务名称（文本）、所属项目（文本）、负责人（文本）、状态（单选：待办/进行中/已完成）、优先级（单选：高/中/低）、开始日期（日期）、截止日期（日期）、完成进度（数字）。',
    expect: [
      { name: '任务名称' }, { name: '所属项目' }, { name: '负责人' },
      { name: '状态', select: 3 }, { name: '优先级', select: 3 },
      { name: '开始日期' }, { name: '截止日期' }, { name: '完成进度' },
    ],
  },
  {
    key: 'crm', label: 'CRM客户管理', table: '客户',
    prompt: '帮我建一个「客户管理」表，需要这些字段：客户名称（文本）、联系人（文本）、联系电话（电话）、客户来源（单选：官网/广告/转介绍/展会）、客户等级（单选：A/B/C）、意向状态（单选：初步接触/方案沟通/已成交/已流失）、负责人（文本）、下次跟进日期（日期）、备注（文本）。',
    expect: [
      { name: '客户名称' }, { name: '联系人' }, { name: '联系电话' },
      { name: '客户来源', select: 3 }, { name: '客户等级', select: 3 },
      { name: '意向状态', select: 3 }, { name: '负责人' }, { name: '下次跟进日期' }, { name: '备注' },
    ],
  },
  {
    key: 'order', label: '销售订单管理', table: '订单',
    prompt: '创建一个「销售订单」数据表，字段：订单编号（文本）、客户名称（文本）、产品名称（文本）、数量（数字）、单价（数字）、订单金额（数字）、订单状态（单选：待付款/已付款/已发货/已完成）、下单日期（日期）、负责人（文本）。',
    expect: [
      { name: '订单编号' }, { name: '客户名称' }, { name: '产品名称' },
      { name: '数量' }, { name: '单价' }, { name: '订单金额' },
      { name: '订单状态', select: 3 }, { name: '下单日期' }, { name: '负责人' },
    ],
  },
  {
    key: 'employee', label: '员工信息管理', table: '员工',
    prompt: '建一个「员工信息」表，包含：姓名（文本）、工号（文本）、部门（单选：研发/市场/销售/人事/财务）、职位（文本）、入职日期（日期）、联系电话（电话）、邮箱（文本）、在职状态（单选：在职/离职/试用期）。',
    expect: [
      { name: '姓名' }, { name: '工号' }, { name: '部门', select: 3 },
      { name: '职位' }, { name: '入职日期' }, { name: '联系电话' },
      { name: '邮箱' }, { name: '在职状态', select: 3 },
    ],
  },
  {
    key: 'inventory', label: '产品库存管理', table: '库存',
    prompt: '帮我创建「产品库存」数据表，字段有：产品名称（文本）、SKU（文本）、分类（单选：电子/服饰/食品/家居）、库存数量（数字）、安全库存（数字）、单位（文本）、供应商（文本）、最近入库日期（日期）。',
    expect: [
      { name: '产品名称' }, { name: 'SKU' }, { name: '分类', select: 3 },
      { name: '库存数量' }, { name: '安全库存' }, { name: '单位' },
      { name: '供应商' }, { name: '入库日期' },
    ],
  },
  {
    key: 'okr', label: 'OKR目标管理', table: 'OKR',
    prompt: '创建一个「OKR 目标」表，字段：目标名称（文本）、负责人（文本）、周期（单选：Q1/Q2/Q3/Q4）、关键结果（文本）、完成进度（数字）、状态（单选：未开始/进行中/已达成/已取消）、优先级（单选：高/中/低）。',
    expect: [
      { name: '目标名称' }, { name: '负责人' }, { name: '周期', select: 3 },
      { name: '关键结果' }, { name: '完成进度' },
      { name: '状态', select: 3 }, { name: '优先级', select: 3 },
    ],
  },
  {
    key: 'content', label: '内容发布日历', table: '内容',
    prompt: '建一个「内容发布日历」数据表，字段包括：标题（文本）、内容类型（单选：图文/视频/直播）、发布平台（多选：公众号/抖音/小红书/视频号）、负责人（文本）、计划发布日期（日期）、状态（单选：草稿/待审核/已发布）、链接（URL）。',
    expect: [
      { name: '标题' }, { name: '内容类型', select: 3 }, { name: '发布平台', select: 4 },
      { name: '负责人' }, { name: '计划发布日期' }, { name: '状态', select: 3 }, { name: '链接' },
    ],
  },
  {
    key: 'recruit', label: '招聘候选人管理', table: '候选人',
    prompt: '帮我做一个「招聘候选人」表，字段：候选人姓名（文本）、应聘职位（文本）、联系电话（电话）、简历来源（单选：招聘网站/内推/猎头/校招）、面试状态（单选：待筛选/初试/复试/已录用/已淘汰）、期望薪资（数字）、面试官（文本）、面试日期（日期）。',
    expect: [
      { name: '候选人姓名' }, { name: '应聘职位' }, { name: '联系电话' },
      { name: '简历来源', select: 3 }, { name: '面试状态', select: 3 },
      { name: '期望薪资' }, { name: '面试官' }, { name: '面试日期' },
    ],
  },
  {
    key: 'expense', label: '费用报销管理', table: '报销',
    prompt: '创建「费用报销」数据表，字段有：报销单号（文本）、报销人（文本）、费用类型（单选：差旅/餐饮/办公/交通/其他）、金额（数字）、发生日期（日期）、报销状态（单选：待审批/已通过/已驳回/已打款）、备注（文本）。',
    expect: [
      { name: '报销单号' }, { name: '报销人' }, { name: '费用类型', select: 3 },
      { name: '金额' }, { name: '发生日期' }, { name: '报销状态', select: 3 }, { name: '备注' },
    ],
  },
  {
    key: 'event', label: '活动策划管理', table: '活动',
    prompt: '帮我建一个「活动策划」表，字段：活动名称（文本）、活动类型（单选：线上/线下/混合）、负责人（文本）、开始时间（日期）、结束时间（日期）、预算（数字）、预计参与人数（数字）、状态（单选：筹备中/进行中/已结束/已取消）。',
    expect: [
      { name: '活动名称' }, { name: '活动类型', select: 3 }, { name: '负责人' },
      { name: '开始时间' }, { name: '结束时间' }, { name: '预算' },
      { name: '参与人数' }, { name: '状态', select: 3 },
    ],
  },
]
