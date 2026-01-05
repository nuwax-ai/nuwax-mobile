/** 
 * H5工具
 */

// 线上调试
export const debug = async (tip = true) => {
    const erudaList = [
        'https://unpkg.com/eruda',
        'https://cdn.jsdelivr.net/npm/eruda',
        '/eruda.js',
    ]
    let idx = 0
    while (erudaList[idx]) {
        try {
            await loadScript(erudaList[idx])
            eruda.init()
            if (tip) alert('debug ready')
            return Promise.resolve('加载成功')
        } catch (e) {
            idx++
        }
    }
    return Promise.reject('加载失败')
}

// 获取查询参数
export const getQueryParams = (url) => {
    url = url || window?.location?.href
    const queryString = String(url).split('?').at(-1);
    if (!queryString) {
        return {};
    }

    return queryString.split('&').reduce((params, param) => {
        const [key, value] = param.split('=');
        if (key && value) params[key] = decodeURIComponent(value);
        return params;
    }, {});
}

// 判断浏览器
export const judgeBrowser = () => {
    const userAgent = navigator.userAgent.toLowerCase();
    if (userAgent.includes('micromessenger')) return 'wx'
    if (userAgent.includes('alipay')) return 'ali'
    return 'unknown'
}

// 加载 js script
export const loadScript = (src) => {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.onload = () => resolve(script);
        script.onerror = (error) => reject(error);
        document.head.appendChild(script);
    });
}



/**
 * 微信公众号相关
 */

// 微信公众号授权获取 code
export const getWxAuthCode = (appId, state = '', scope = 'snsapi_base') => {
    /**
     * 以snsapi_base为scope发起的网页授权，是用来获取进入页面的用户的openid的，
     * 并且是静默授权并自动跳转到回调页的。用户感知的就是直接进入了回调页（往往是业务页面）
     * 以snsapi_userinfo为scope发起的网页授权，是用来获取用户的基本信息的。但这种授权需要用户手动同意，
     * 并且由于用户同意过，所以无须关注，就可在授权后获取该用户的基本信息。
     */
    const redirect_uri = encodeURIComponent(window.location.href);
    const authUrl = `http://open.weixin.qq.com/connect/oauth2/authorize
		?appid=${appId}
		&redirect_uri=${redirect_uri}
		&response_type=code
		&scope=${scope}
		&state=${state}#wechat_redirect`;
    window.location.href = authUrl
}

export const wxConfig = (params) => {
    /**
     * config信息验证后会执行ready方法，所有接口调用都必须在config接口获得结果之后，
     * config是一个客户端的异步操作，所以如果需要在页面加载时就调用相关接口，
     * 则须把相关接口放在ready函数中调用来确保正确执行。对于用户触发时才调用的接口，
     * 则可以直接调用，不需要放在ready函数中。
     */
    jWeixin.config({
        debug: false,
        appId: params.appId,
        timestamp: params.timestamp,
        nonceStr: params.noncestr,
        signature: params.signature,
        jsApiList: [
            "updateTimelineShareData",
            "updateAppMessageShareData",
            "chooseWXPay",
        ]
    });
}

// 微信公众号支付
export const wxPay = (params) => {
    console.log('wxPay', params);
    wxConfig(params)
    return new Promise((resolve, reject) => {
        jWeixin.ready(function() {
            jWeixin.chooseWXPay({
                timestamp: params.timeStamp,
                nonceStr: params.nonceStr,
                package: params.package,
                signType: params.signType,
                paySign: params.paySign,
                success: function(res) {
                    console.log('支付成功:', res);
                    resolve(res)
                },
                cancel: function(res) {
                    console.log('用户取消支付:', res);
                    reject(res)
                },
                fail: function(err) {
                    console.error('支付失败:', err);
                    reject(err)
                }
            });
        });
        wx.error(function(res) {
            reject(res)
        })
    })
};

// 微信公众号设置分享信息
export const wxShare = (params) => {
    console.log('wxShare', params);
    //配置校验成功后执行
    jWeixin.ready(function() {
        if (!params.link) {
            let url = window.location.href;
            let index = url.indexOf("?");
            if (index != -1) {
                if (url.indexOf("#") != -1 && url.indexOf("#") > index) {
                    url = url.substring(0, index) + url.substring(url.indexOf("#"));
                } else {
                    url = url.substr(0, index);
                }
            }
            params.link = url;
        }
        // 自定义“分享给朋友”及“分享到QQ”按钮的分享内容
        jWeixin.updateAppMessageShareData({
            title: params.title, // 分享标题
            desc: params.desc, // 分享描述
            link: params.link, // 分享链接，该链接域名或路径必须与当前页面对应的公众号JS安全域名一致
            imgUrl: params.imgUrl, // 分享图标
            success: function() {
                console.log('updateAppMessageShareData success');
            },
            fail: err => {
                console.log('updateAppMessageShareData fail', err);
            }
        });

        // 自定义“分享到朋友圈”及“分享到QQ空间”按钮的分享内容
        jWeixin.updateTimelineShareData({
            title: params.title, // 分享标题
            link: params.link, // 分享链接，该链接域名或路径必须与当前页面对应的公众号JS安全域名一致
            imgUrl: params.imgUrl, // 分享图标
            success: function() {
                console.log('updateTimelineShareData success');
            },
            fail: err => {
                console.log('updateTimelineShareData fail', err);
            }
        });
        console.log('wxShare', params);
    });
}

/**
 * 支付宝相关
 */

// 支付宝生活号授权获取 code
export const getAliAuthCode = (appId, scope = 'auth_base') => {
    /**
     * auth_base(静默授权)：静默授权，用户无需点击确认授权，默认返回 auth_code，该授权码不支持获取用户信息。
     * auth_user(主动授权)：首次授权需要用户手动点击同意，用户同意后，返回 auth_code；
     * 商家需要考虑用户拒绝授权的情况并进行相应容错。如果授权关系依旧存在，下次进入页面时也会静默授权。
     */
    return new Promise((resolve, reject) => {
        ap.getAuthCode({
            appId,
            scopes: [scope],
        }, function(res) {
            if (res.error) {
                reject(res)
            } else {
                resolve(res)
            }
        });
    })
}

// 支付宝生活号支付
export const aliPay = (tradeNO) => {
    return new Promise((resolve, reject) => {
        console.log('aliPay', tradeNO);
        ap.tradePay({
            tradeNO,
            success: res => {
                if (res.resultCode === '9000') {
                    resolve(res)
                } else {
                    reject(res)
                }
            },
            fail: err => {
                reject(err)
            },
        });
    })
}