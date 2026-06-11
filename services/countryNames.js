'use strict';

const COUNTRY_ZH = {
  'Mexico': '墨西哥',
  'South Africa': '南非',
  'South Korea': '韩国',
  'Czech Republic': '捷克',
  'Czechia': '捷克',
  'Canada': '加拿大',
  'Switzerland': '瑞士',
  'Qatar': '卡塔尔',
  'Bosnia': '波黑',
  'Bosnia & Herzegovina': '波黑',
  'Brazil': '巴西',
  'Morocco': '摩洛哥',
  'Haiti': '海地',
  'Scotland': '苏格兰',
  'USA': '美国',
  'United States': '美国',
  'Paraguay': '巴拉圭',
  'Australia': '澳大利亚',
  'Turkey': '土耳其',
  'Türkiye': '土耳其',
  'Germany': '德国',
  'Curacao': '库拉索',
  'Curaçao': '库拉索',
  'Ivory Coast': '科特迪瓦',
  "Côte d'Ivoire": '科特迪瓦',
  'Ecuador': '厄瓜多尔',
  'Netherlands': '荷兰',
  'Japan': '日本',
  'Sweden': '瑞典',
  'Tunisia': '突尼斯',
  'Belgium': '比利时',
  'Egypt': '埃及',
  'Iran': '伊朗',
  'New Zealand': '新西兰',
  'Spain': '西班牙',
  'Cape Verde': '佛得角',
  'Saudi Arabia': '沙特阿拉伯',
  'Uruguay': '乌拉圭',
  'France': '法国',
  'Senegal': '塞内加尔',
  'Norway': '挪威',
  'Iraq': '伊拉克',
  'Argentina': '阿根廷',
  'Algeria': '阿尔及利亚',
  'Austria': '奥地利',
  'Jordan': '约旦',
  'Portugal': '葡萄牙',
  'DR Congo': '刚果民主共和国',
  'Congo DR': '刚果民主共和国',
  'Uzbekistan': '乌兹别克斯坦',
  'Colombia': '哥伦比亚',
  'England': '英格兰',
  'Croatia': '克罗地亚',
  'Ghana': '加纳',
  'Panama': '巴拿马',
  'draw': '平局',
  'Draw': '平局',
};

/**
 * Translate a country/team name to Chinese. Returns original if no translation found.
 * @param {string} name
 * @returns {string}
 */
function toZh(name) {
  return COUNTRY_ZH[name] || name;
}

module.exports = { COUNTRY_ZH, toZh };
