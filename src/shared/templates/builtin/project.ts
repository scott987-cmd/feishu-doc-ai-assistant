import type { ScenarioTemplate } from '../types'

export const PROJECT_TEMPLATE: ScenarioTemplate = {
  id: 'project-management',
  name: '项目管理系统',
  description: '任务、里程碑、成员三表联动，含甘特图和看板视图，适合中小团队',
  icon: '📋',
  category: '项目管理',
  tags: ['任务', '里程碑', '团队', '项目'],
  version: '1.0.0',
  source: 'builtin',
  target: 'new_app',
  preview: { tables: 3, views: 6, records: 12 },

  inputs: [
    {
      key: 'app_name',
      label: '项目名称',
      type: 'text',
      placeholder: '我的项目',
      default: '项目管理系统',
      required: true,
    },
    {
      key: 'team',
      label: '团队名称',
      type: 'text',
      placeholder: '研发团队',
      default: '研发团队',
    },
  ],

  tables: [
    {
      ref: 'tasks',
      name: '任务',
      fields: [
        { name: '任务名称', type: 1 },
        {
          name: '状态', type: 3,
          options: [
            { name: '待开始', color: 1 },
            { name: '进行中', color: 10 },
            { name: '审核中', color: 20 },
            { name: '已完成', color: 40 },
            { name: '已搁置', color: 30 },
          ],
        },
        {
          name: '优先级', type: 3,
          options: [
            { name: '🔴 紧急', color: 2 },
            { name: '🟡 高', color: 18 },
            { name: '🟢 中', color: 38 },
            { name: '⚪ 低', color: 0 },
          ],
        },
        { name: '负责人', type: 1 },
        { name: '开始日期', type: 5 },
        { name: '截止日期', type: 5 },
        { name: '预计工时(h)', type: 2 },
        {
          name: '所属模块', type: 3,
          options: [
            { name: '需求分析', color: 5 },
            { name: '设计', color: 15 },
            { name: '开发', color: 25 },
            { name: '测试', color: 35 },
            { name: '上线', color: 45 },
          ],
        },
        { name: '备注', type: 1 },
      ],
      views: [
        { name: '全部任务', type: 'grid' },
        { name: '任务看板', type: 'kanban' },
        { name: '甘特图', type: 'gantt' },
      ],
      sample_records: [
        { 任务名称: '需求调研与文档', 状态: '已完成', 优先级: '🔴 紧急', 负责人: '产品经理', 开始日期: 1714492800000, 截止日期: 1714924800000, '预计工时(h)': 16, 所属模块: '需求分析' },
        { 任务名称: 'UI 原型设计', 状态: '已完成', 优先级: '🟡 高', 负责人: 'UI设计师', 开始日期: 1714924800000, 截止日期: 1715529600000, '预计工时(h)': 24, 所属模块: '设计' },
        { 任务名称: '前端框架搭建', 状态: '进行中', 优先级: '🟡 高', 负责人: '前端工程师', 开始日期: 1715529600000, 截止日期: 1716134400000, '预计工时(h)': 32, 所属模块: '开发' },
        { 任务名称: '后端 API 开发', 状态: '进行中', 优先级: '🔴 紧急', 负责人: '后端工程师', 开始日期: 1715529600000, 截止日期: 1716739200000, '预计工时(h)': 80, 所属模块: '开发' },
        { 任务名称: '单元测试编写', 状态: '待开始', 优先级: '🟢 中', 负责人: '测试工程师', 开始日期: 1716739200000, 截止日期: 1717344000000, '预计工时(h)': 24, 所属模块: '测试' },
      ],
    },
    {
      ref: 'milestones',
      name: '里程碑',
      fields: [
        { name: '里程碑名称', type: 1 },
        {
          name: '状态', type: 3,
          options: [
            { name: '未达成', color: 1 },
            { name: '进行中', color: 10 },
            { name: '已达成', color: 40 },
            { name: '已延期', color: 2 },
          ],
        },
        { name: '目标日期', type: 5 },
        { name: '负责人', type: 1 },
        { name: '验收标准', type: 1 },
      ],
      views: [
        { name: '里程碑列表', type: 'grid' },
      ],
      sample_records: [
        { 里程碑名称: 'MVP 版本上线', 状态: '进行中', 目标日期: 1717948800000, 负责人: '项目经理', 验收标准: '核心功能可用，无严重 Bug' },
        { 里程碑名称: '性能优化完成', 状态: '未达成', 目标日期: 1719158400000, 负责人: '技术负责人', 验收标准: '页面加载 < 2s，接口响应 < 200ms' },
        { 里程碑名称: 'v1.0 正式发布', 状态: '未达成', 目标日期: 1720368000000, 负责人: '项目经理', 验收标准: '所有需求实现，测试通过率 > 95%' },
      ],
    },
    {
      ref: 'members',
      name: '成员',
      fields: [
        { name: '姓名', type: 1 },
        {
          name: '角色', type: 3,
          options: [
            { name: '项目经理', color: 5 },
            { name: '产品经理', color: 15 },
            { name: '前端工程师', color: 25 },
            { name: '后端工程师', color: 35 },
            { name: 'UI设计师', color: 45 },
            { name: '测试工程师', color: 20 },
          ],
        },
        { name: '部门', type: 1 },
        { name: '邮箱', type: 1 },
        { name: '在负责任务数', type: 2 },
        {
          name: '状态', type: 3,
          options: [
            { name: '在职', color: 40 },
            { name: '休假', color: 10 },
            { name: '离职', color: 30 },
          ],
        },
      ],
      views: [
        { name: '成员列表', type: 'grid' },
        { name: '成员画册', type: 'gallery' },
      ],
      sample_records: [
        { 姓名: '赵磊', 角色: '项目经理', 部门: '研发部', 邮箱: 'zhaolei@example.com', 在负责任务数: 2, 状态: '在职' },
        { 姓名: '陈琳', 角色: '前端工程师', 部门: '研发部', 邮箱: 'chenlin@example.com', 在负责任务数: 3, 状态: '在职' },
        { 姓名: '刘洋', 角色: '后端工程师', 部门: '研发部', 邮箱: 'liuyang@example.com', 在负责任务数: 4, 状态: '在职' },
        { 姓名: '周敏', 角色: '测试工程师', 部门: '质量部', 邮箱: 'zhoumin@example.com', 在负责任务数: 2, 状态: '在职' },
      ],
    },
  ],
}
