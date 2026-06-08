import type { ScenarioTemplate } from '../types'

export const CRM_TEMPLATE: ScenarioTemplate = {
  id: 'crm',
  name: '销售 CRM 系统',
  description: '客户、联系人、商机三表体系，商机漏斗看板，完整销售流程管理',
  icon: '💼',
  category: 'CRM',
  tags: ['客户', '销售', '商机', 'CRM'],
  version: '1.0.0',
  source: 'builtin',
  target: 'new_app',
  preview: { tables: 3, views: 5, records: 12 },

  inputs: [
    {
      key: 'app_name',
      label: '应用名称',
      type: 'text',
      placeholder: '销售管理系统',
      default: '销售 CRM',
      required: true,
    },
    {
      key: 'currency',
      label: '金额单位',
      type: 'select',
      default: '万元',
      options: [
        { value: '万元', label: '万元 (¥)' },
        { value: '元', label: '元 (¥)' },
        { value: 'K USD', label: '千美元 ($K)' },
      ],
    },
  ],

  tables: [
    {
      ref: 'companies',
      name: '客户',
      fields: [
        { name: '公司名称', type: 1 },
        {
          name: '行业', type: 3,
          options: [
            { name: '互联网', color: 15 }, { name: '金融', color: 5 },
            { name: '制造业', color: 35 }, { name: '零售', color: 25 },
            { name: '医疗健康', color: 45 }, { name: '教育', color: 20 },
          ],
        },
        {
          name: '规模', type: 3,
          options: [
            { name: '初创 < 50人', color: 0 },
            { name: '中小 50-500人', color: 10 },
            { name: '大型 > 500人', color: 40 },
          ],
        },
        {
          name: '客户状态', type: 3,
          options: [
            { name: '线索', color: 1 },
            { name: '跟进中', color: 10 },
            { name: '意向客户', color: 20 },
            { name: '签约客户', color: 40 },
            { name: '流失', color: 30 },
          ],
        },
        { name: '负责销售', type: 1 },
        { name: '官网', type: 15 },
        { name: '地址', type: 1 },
        { name: '客户来源', type: 3, options: [{ name: '官网询盘' }, { name: '展会' }, { name: '渠道推荐' }, { name: '主动开发' }] },
        { name: '备注', type: 1 },
      ],
      views: [
        { name: '客户列表', type: 'grid' },
      ],
      sample_records: [
        { 公司名称: '星辰科技有限公司', 行业: '互联网', 规模: '中小 50-500人', 客户状态: '意向客户', 负责销售: '王明', 客户来源: '官网询盘' },
        { 公司名称: '汇丰贸易集团', 行业: '零售', 规模: '大型 > 500人', 客户状态: '跟进中', 负责销售: '张艳', 客户来源: '展会' },
        { 公司名称: '未来教育科技', 行业: '教育', 规模: '初创 < 50人', 客户状态: '线索', 负责销售: '李强', 客户来源: '渠道推荐' },
        { 公司名称: '康健医疗器械', 行业: '医疗健康', 规模: '中小 50-500人', 客户状态: '签约客户', 负责销售: '王明', 客户来源: '主动开发' },
      ],
    },
    {
      ref: 'contacts',
      name: '联系人',
      fields: [
        { name: '姓名', type: 1 },
        { name: '职位', type: 1 },
        { name: '所属公司', type: 1 },
        {
          name: '决策角色', type: 3,
          options: [
            { name: '决策人', color: 40 },
            { name: '影响者', color: 20 },
            { name: '使用者', color: 10 },
            { name: '门卫', color: 1 },
          ],
        },
        { name: '手机', type: 13 },
        { name: '邮箱', type: 1 },
        { name: '微信', type: 1 },
        { name: '最近联系', type: 5 },
      ],
      views: [{ name: '联系人列表', type: 'grid' }],
      sample_records: [
        { 姓名: '张伟', 职位: 'CTO', 所属公司: '星辰科技有限公司', 决策角色: '决策人', 手机: '13900000001', 邮箱: 'zhangwei@star.com', 最近联系: 1715097600000 },
        { 姓名: '李娜', 职位: '采购总监', 所属公司: '汇丰贸易集团', 决策角色: '决策人', 手机: '13900000002', 邮箱: 'lina@hf.com', 最近联系: 1715270400000 },
        { 姓名: '刘洋', 职位: '产品负责人', 所属公司: '未来教育科技', 决策角色: '影响者', 手机: '13900000003', 邮箱: 'liuyang@future.edu', 最近联系: 1714492800000 },
        { 姓名: '赵芳', 职位: '院长', 所属公司: '康健医疗器械', 决策角色: '决策人', 手机: '13900000004', 邮箱: 'zhaofang@kj.com', 最近联系: 1715616000000 },
      ],
    },
    {
      ref: 'deals',
      name: '商机',
      fields: [
        { name: '商机名称', type: 1 },
        { name: '客户名称', type: 1 },
        { name: '预计金额', type: 2 },
        {
          name: '阶段', type: 3,
          options: [
            { name: '初步接触', color: 1 },
            { name: '需求确认', color: 10 },
            { name: '方案呈现', color: 18 },
            { name: '商务谈判', color: 25 },
            { name: '合同签署', color: 40 },
            { name: '已关闭', color: 30 },
          ],
        },
        { name: '赢率(%)', type: 2 },
        { name: '预计成交日', type: 5 },
        { name: '负责销售', type: 1 },
        { name: '下一步行动', type: 1 },
      ],
      views: [
        { name: '商机列表', type: 'grid' },
        { name: '销售漏斗', type: 'kanban' },
        { name: '成交预测', type: 'gantt' },
      ],
      sample_records: [
        { 商机名称: '星辰 SaaS 年度合同', 客户名称: '星辰科技有限公司', 预计金额: 30, 阶段: '商务谈判', '赢率(%)': 70, 预计成交日: 1716739200000, 负责销售: '王明', 下一步行动: '发送合同草案' },
        { 商机名称: '汇丰供应链模块', 客户名称: '汇丰贸易集团', 预计金额: 80, 阶段: '方案呈现', '赢率(%)': 40, 预计成交日: 1718553600000, 负责销售: '张艳', 下一步行动: '安排产品演示' },
        { 商机名称: '未来教育平台', 客户名称: '未来教育科技', 预计金额: 10, 阶段: '需求确认', '赢率(%)': 20, 预计成交日: 1719158400000, 负责销售: '李强', 下一步行动: '整理需求文档' },
        { 商机名称: '康健设备管理续费', 客户名称: '康健医疗器械', 预计金额: 15, 阶段: '合同签署', '赢率(%)': 95, 预计成交日: 1715616000000, 负责销售: '王明', 下一步行动: '等待盖章' },
      ],
    },
  ],
}
