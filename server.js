/**
 * @author: Xiaoqiang
 * @wechat_official_account: XiaoqiangClub
 * @create_time: 2025-08-14T06:23:00.000Z
 * @file_description: 项目的本地服务器入口文件。
 * @file_path: server.js
 */

const express = require('express');
const cors = require('cors');
const yaml = require('js-yaml');
const { SingboxConfigBuilder } = require('./src/SingboxConfigBuilder.js');
const { generateHtml } = require('./src/htmlBuilder.js');
const { ClashConfigBuilder } = require('./src/ClashConfigBuilder.js');
const { SurgeConfigBuilder } = require('./src/SurgeConfigBuilder.js');
const { decodeBase64, encodeBase64, GenerateWebPath } = require('./src/utils.js');
const { PREDEFINED_RULE_SETS } = require('./src/config.js');
const { t, setLanguage } = require('./src/i18n/index.js');

const app = express();
const port = process.env.PORT || 3000;

// 模拟 Cloudflare KV
const SUBLINK_KV = new Map();

app.use(cors());
app.use(express.json());
app.use(express.text({ type: 'text/plain' }));
app.use(express.urlencoded({ extended: true }));

// 配置静态文件服务
app.use(express.static('public'));

// 主路由处理
app.all('*', async (req, res) => {
    try {
        const url = new URL(req.protocol + '://' + req.get('host') + req.originalUrl);
        const lang = url.searchParams.get('lang');
        setLanguage(lang || req.headers['accept-language']?.split(','));

        // 主页
        if (req.method === 'GET' && url.pathname === '/') {
            return res.header('Content-Type', 'text/html; charset=utf-8').send(generateHtml('', '', '', '', url.origin));
        }

        // 订阅转换
        if (url.pathname.startsWith('/singbox') || url.pathname.startsWith('/clash') || url.pathname.startsWith('/surge')) {
            const inputString = url.searchParams.get('config');
            let selectedRules = url.searchParams.get('selectedRules');
            let customRules = url.searchParams.get('customRules');
            let lang = url.searchParams.get('lang') || 'zh-CN';
            let userAgent = url.searchParams.get('ua') || 'curl/7.74.0';

            if (!inputString) {
                return res.status(400).send(t('missingConfig'));
            }

            if (PREDEFINED_RULE_SETS[selectedRules]) {
                selectedRules = PREDEFINED_RULE_SETS[selectedRules];
            } else {
                try {
                    selectedRules = JSON.parse(decodeURIComponent(selectedRules));
                } catch (error) {
                    console.error('解析 selectedRules 出错:', error);
                    selectedRules = PREDEFINED_RULE_SETS.minimal;
                }
            }

            try {
                customRules = JSON.parse(decodeURIComponent(customRules));
            } catch (error) {
                console.error('解析 customRules 出错:', error);
                customRules = [];
            }

            const configId = url.searchParams.get('configId');
            let baseConfig;
            if (configId && SUBLINK_KV.has(configId)) {
                baseConfig = JSON.parse(SUBLINK_KV.get(configId));
            }

            let configBuilder;
            if (url.pathname.startsWith('/singbox')) {
                configBuilder = new SingboxConfigBuilder(inputString, selectedRules, customRules, baseConfig, lang, userAgent);
            } else if (url.pathname.startsWith('/clash')) {
                configBuilder = new ClashConfigBuilder(inputString, selectedRules, customRules, baseConfig, lang, userAgent);
            } else {
                configBuilder = new SurgeConfigBuilder(inputString, selectedRules, customRules, baseConfig, lang, userAgent)
                    .setSubscriptionUrl(url.href);
            }

            const config = await configBuilder.build();

            const headers = {
                'content-type': url.pathname.startsWith('/singbox')
                    ? 'application/json; charset=utf-8'
                    : url.pathname.startsWith('/clash')
                        ? 'text/yaml; charset=utf-8'
                        : 'text/plain; charset=utf-8'
            };

            if (url.pathname.startsWith('/surge')) {
                headers['subscription-userinfo'] = 'upload=0; download=0; total=10737418240; expire=2546249531';
            }

            return res.set(headers).send(
                url.pathname.startsWith('/singbox') ? JSON.stringify(config, null, 2) : config
            );
        }

        // 短链接生成
        if (url.pathname === '/shorten') {
            const originalUrl = url.searchParams.get('url');
            if (!originalUrl) {
                return res.status(400).send(t('missingUrl'));
            }
            const shortCode = GenerateWebPath();
            SUBLINK_KV.set(shortCode, originalUrl);
            const shortUrl = `${url.origin}/s/${shortCode}`;
            return res.json({ shortUrl });
        }

        // 短链接生成 V2
        if (url.pathname === '/shorten-v2') {
            const originalUrl = url.searchParams.get('url');
            let shortCode = url.searchParams.get('shortCode');
            if (!originalUrl) {
                return res.status(400).send('Missing URL parameter');
            }
            const parsedUrl = new URL(originalUrl);
            const queryString = parsedUrl.search;
            if (!shortCode) {
                shortCode = GenerateWebPath();
            }
            SUBLINK_KV.set(shortCode, queryString);
            return res.type('text/plain').send(shortCode);
        }

        // 短链接跳转
        if (url.pathname.startsWith('/b/') || url.pathname.startsWith('/c/') || url.pathname.startsWith('/x/') || url.pathname.startsWith('/s/')) {
            const shortCode = url.pathname.split('/');
            const originalParam = SUBLINK_KV.get(shortCode);
            if (originalParam === undefined) {
                return res.status(404).send(t('shortUrlNotFound'));
            }
            let originalUrl;
            if (url.pathname.startsWith('/b/')) {
                originalUrl = `${url.origin}/singbox${originalParam}`;
            } else if (url.pathname.startsWith('/c/')) {
                originalUrl = `${url.origin}/clash${originalParam}`;
            } else if (url.pathname.startsWith('/x/')) {
                originalUrl = `${url.origin}/xray${originalParam}`;
            } else if (url.pathname.startsWith('/s/')) {
                originalUrl = `${url.origin}/surge${originalParam}`;
            }
            return res.redirect(302, originalUrl);
        }

        // Xray 配置处理
        if (url.pathname.startsWith('/xray')) {
            const inputString = url.searchParams.get('config');
            const proxylist = inputString.split('\n');
            const finalProxyList = [];
            let userAgent = url.searchParams.get('ua') || 'curl/7.74.0';
            let headers = { "User-Agent": userAgent };

            for (const proxy of proxylist) {
                if (proxy.startsWith('http://') || proxy.startsWith('https://')) {
                    try {
                        const response = await fetch(proxy, { method: 'GET', headers: headers });
                        const text = await response.text();
                        let decodedText = decodeBase64(text.trim());
                        if (decodedText.includes('%')) {
                            decodedText = decodeURIComponent(decodedText);
                        }
                        finalProxyList.push(...decodedText.split('\n'));
                    } catch (e) {
                        console.warn('获取代理失败:', e);
                    }
                } else {
                    finalProxyList.push(proxy);
                }
            }
            const finalString = finalProxyList.join('\n');
            if (!finalString) {
                return res.status(400).send('Missing config parameter');
            }
            return res.type('application/json; charset=utf-8').send(encodeBase64(finalString));
        }

        // Favicon
        if (url.pathname === '/favicon.ico' || url.pathname === '/favicon.png') {
            const path = require('path');
            return res.sendFile(path.join(__dirname, 'public', 'favicon.png'));
        }

        // 保存配置
        if (url.pathname === '/config') {
            const { type, content } = req.body;
            const configId = `${type}_${GenerateWebPath(8)}`;
            try {
                let configString;
                if (type === 'clash') {
                    if (typeof content === 'string' && (content.trim().startsWith('-') || content.includes(':'))) {
                        const yamlConfig = yaml.load(content);
                        configString = JSON.stringify(yamlConfig);
                    } else {
                        configString = typeof content === 'object' ? JSON.stringify(content) : content;
                    }
                } else {
                    configString = typeof content === 'object' ? JSON.stringify(content) : content;
                }
                JSON.parse(configString);
                SUBLINK_KV.set(configId, configString); // TTL logic needs to be handled differently in local env
                return res.type('text/plain').send(configId);
            } catch (error) {
                console.error('配置验证错误:', error);
                return res.status(400).type('text/plain').send(t('invalidFormat') + error.message);
            }
        }

        // 解析短链接
        if (url.pathname === '/resolve') {
            const shortUrl = url.searchParams.get('url');
            if (!shortUrl) {
                return res.status(400).send(t('missingUrl'));
            }
            try {
                const urlObj = new URL(shortUrl);
                const pathParts = urlObj.pathname.split('/');
                if (pathParts.length < 3) {
                    return res.status(400).send(t('invalidShortUrl'));
                }
                const prefix = pathParts;
                const shortCode = pathParts;
                if (!['b', 'c', 'x', 's'].includes(prefix)) {
                    return res.status(400).send(t('invalidShortUrl'));
                }
                const originalParam = SUBLINK_KV.get(shortCode);
                if (originalParam === undefined) {
                    return res.status(404).send(t('shortUrlNotFound'));
                }
                let originalUrl;
                if (prefix === 'b') {
                    originalUrl = `${url.origin}/singbox${originalParam}`;
                } else if (prefix === 'c') {
                    originalUrl = `${url.origin}/clash${originalParam}`;
                } else if (prefix === 'x') {
                    originalUrl = `${url.origin}/xray${originalParam}`;
                } else if (prefix === 's') {
                    originalUrl = `${url.origin}/surge${originalParam}`;
                }
                return res.json({ originalUrl });
            } catch (error) {
                return res.status(400).send(t('invalidShortUrl'));
            }
        }

        res.status(404).send(t('notFound'));
    } catch (error) {
        console.error('处理请求时出错:', error);
        res.status(500).send(t('internalError'));
    }
});

app.listen(port, () => {
    console.log(`服务器正在监听 http://localhost:${port}`);
});