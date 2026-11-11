// Submission guidelines and agreements shown on terms.html, submit-game.html and profile.html.
// `version` must match functions/lib/terms.js; change both whenever the text changes in substance.
(function (root) {
  const CONTACT = 'wangyanhui@sryinteractive.com';
  const version = { developer: '2026-11-11', partner: '2026-11-11' };

  const guidelines = {
    en: { title: 'Before you submit', items: [
      'This is a B2B platform. Your readers are publishers and investors, not players. Write for them: positioning, progress and team, and the partnership you are looking for, rather than player-facing marketing copy.',
      'Submit only games you or your team are developing, with accurate information and material you have the right to use.',
      'Listings are reviewed before they go live. We may translate, edit or reformat your content.'
    ] },
    zh: { title: '提交须知', items: [
      '这是 B2B 平台，读者是发行商和投资者，不是玩家。请面向他们写：产品定位、进度与团队、合作需求，而不是面向玩家的宣传文案。',
      '只提交你或你的团队开发的游戏；信息须真实准确，素材须有权使用。',
      '内容经审核后上架，我们可能对其进行翻译、编辑或调整格式。'
    ] },
    ko: { title: '제출 전 안내', items: [
      '이곳은 B2B 플랫폼입니다. 읽는 사람은 플레이어가 아니라 퍼블리셔와 투자자입니다. 플레이어용 홍보 문구 대신 제품 포지셔닝, 진척 상황과 팀, 원하는 협업 내용을 이들에게 맞춰 작성해 주세요.',
      '본인 또는 소속 팀이 개발 중인 게임만 제출하고, 정확한 정보와 사용 권한이 있는 자료만 올려 주세요.',
      '제출 내용은 심사 후 게시되며, 당사가 번역·편집하거나 형식을 조정할 수 있습니다.'
    ] }
  };

  const agreements = {
    developer: {
      en: { title: 'Game Submission Agreement', audience: 'For developers',
        intro: 'By submitting a game to SRY Game Hub (the "Platform", operated by SRY Interactive, "we"), you agree to the terms below. This agreement covers listing your game information on the Platform free of charge; any other cooperation with us is governed by a separate written contract.',
        clauses: [
          ['The Platform', 'SRY Game Hub is a B2B showcase that helps publishers and investors discover games. Please follow the submission guidelines above. We provide exposure and a way to get in touch; we do not guarantee any deal and are not a party to agreements between you and a publisher or investor.'],
          ['Your content', 'You confirm that you own the game or are authorised to submit it, and that everything you submit (text, images, video and logos, including content imported from Steam) is accurate, lawful and does not infringe anyone else\'s rights.'],
          ['Licence to us', 'You keep ownership of your content. You grant us a free, non-exclusive, worldwide licence to host, display, reproduce, translate, edit, summarise, crop and reformat it, and to share it with Platform users, in our project recommendation emails and in promotion of the Platform. We translate and edit so that publishers and investors can read your listing easily; if you spot an error, tell us and we will correct it.'],
          ['Review and removal', 'We decide whether and how a submission is listed, and may decline it, merge duplicate applications or take a listing down. You can ask us to update or remove your listing at any time at ' + CONTACT + '; once removed, it is no longer shown on the Platform.'],
          ['Contact details', 'By providing a contact email (your sign-up email is used unless you set another one in your studio info), you agree that verified publishers and investors on the Platform may view it and contact you about your game, by email or by on-site message. We may also contact you about your submission and partnership opportunities.'],
          ['Liability', 'The Platform is provided as is. Discussions and deals with publishers or investors are between you and them; we are not responsible for their conduct or for the outcome.'],
          ['Changes', 'We may update this agreement and will post the new version on this page. You are asked to agree to the current version each time you submit a game.']
        ] },
      zh: { title: '游戏提交协议', audience: '面向开发者',
        intro: '向 SRY Game Hub（由 SRY Interactive 运营，下称“平台”或“我们”）提交游戏，即表示你同意以下条款。本协议适用于在平台免费提交和展示游戏信息；与我们的其他合作，以双方另行签署的书面合同为准。',
        clauses: [
          ['平台性质', 'SRY Game Hub 是帮助发行商和投资者发现游戏的 B2B 展示平台，提交内容请遵循上方的提交须知。我们提供展示和对接渠道，不保证促成任何合作，也不是你与发行商或投资者之间任何协议的一方。'],
          ['你的内容', '你确认自己拥有该游戏或已获授权提交；所提交的全部内容（文字、图片、视频、Logo，包括从 Steam 导入的内容）真实、合法，且不侵犯他人权利。'],
          ['内容授权', '内容的所有权仍归你。你授予我们一项免费、非独占、全球范围的许可，可以存储、展示、复制、翻译、编辑、摘要、裁剪和调整格式，并提供给平台用户，以及用于我们的项目推荐邮件和平台推广。翻译和编辑是为了方便发行商和投资者阅读；如发现有误，请告诉我们，我们会更正。'],
          ['审核与下架', '是否上架、如何展示由我们决定；我们可以拒绝申请、合并重复申请或下架内容。你可以随时发邮件至 ' + CONTACT + '，要求修改或下架；下架后不再在平台展示。'],
          ['联系方式', '你填写联系邮箱（未另行填写时为注册邮箱），即表示同意平台上经认证的发行商和投资者查看该联系方式，并就你的游戏通过邮件或站内留言与你联系。我们也可能就审核和合作机会联系你。'],
          ['责任', '平台按现状提供。你与发行商或投资者之间的沟通与合作由双方自行负责，我们不对对方的行为或合作结果承担责任。'],
          ['协议更新', '我们可能更新本协议，并在本页公布新版本。每次提交游戏时，都需要同意当时的版本。']
        ] },
      ko: { title: '게임 제출 약관', audience: '개발자용',
        intro: 'SRY Game Hub(SRY Interactive가 운영하며, 이하 "플랫폼" 또는 "당사")에 게임을 제출하면 아래 약관에 동의하는 것으로 봅니다. 본 약관은 플랫폼에 게임 정보를 무료로 제출·게시하는 경우에 적용되며, 당사와의 그 밖의 협업은 별도로 체결하는 서면 계약에 따릅니다.',
        clauses: [
          ['플랫폼의 성격', 'SRY Game Hub는 퍼블리셔와 투자자가 게임을 찾을 수 있도록 돕는 B2B 쇼케이스입니다. 제출 내용은 위의 제출 전 안내를 따라 주세요. 당사는 노출과 연락 창구를 제공할 뿐 계약 성사를 보장하지 않으며, 귀하와 퍼블리셔·투자자 사이의 계약 당사자가 아닙니다.'],
          ['제출 콘텐츠', '귀하는 해당 게임의 권리자이거나 제출 권한을 위임받았으며, 제출하는 모든 콘텐츠(텍스트, 이미지, 영상, 로고, Steam에서 가져온 내용 포함)가 정확하고 적법하며 타인의 권리를 침해하지 않음을 확인합니다.'],
          ['이용 허락', '콘텐츠의 소유권은 귀하에게 있습니다. 귀하는 당사가 콘텐츠를 저장, 게시, 복제, 번역, 편집, 요약, 자르기 및 형식 조정하고, 플랫폼 이용자에게 제공하며 프로젝트 추천 메일과 플랫폼 홍보에 사용할 수 있도록 무상·비독점·전 세계적 이용 허락을 부여합니다. 번역과 편집은 퍼블리셔와 투자자가 읽기 쉽게 하기 위한 것이며, 오류를 발견해 알려 주시면 수정합니다.'],
          ['심사 및 삭제', '게시 여부와 방식은 당사가 결정하며, 신청을 거절하거나 중복 신청을 병합하거나 게시물을 내릴 수 있습니다. 수정이나 삭제는 언제든지 ' + CONTACT + ' 으로 요청할 수 있으며, 삭제 후에는 플랫폼에 표시되지 않습니다.'],
          ['연락처', '연락용 이메일을 입력하면(따로 지정하지 않으면 가입 이메일이 사용됩니다) 플랫폼의 인증된 퍼블리셔와 투자자가 이를 확인하고 귀하의 게임과 관련해 이메일이나 사이트 내 메시지로 연락하는 데 동의하는 것으로 봅니다. 당사도 심사 및 협업 기회와 관련해 연락할 수 있습니다.'],
          ['책임', '플랫폼은 현 상태 그대로 제공됩니다. 퍼블리셔·투자자와의 협의 및 계약은 당사자 간의 일이며, 당사는 상대방의 행위나 협업 결과에 책임을 지지 않습니다.'],
          ['약관 변경', '당사는 본 약관을 변경할 수 있으며 새 버전을 이 페이지에 게시합니다. 게임을 제출할 때마다 당시 버전에 동의해야 합니다.']
        ] }
    },
    partner: {
      en: { title: 'Partner Agreement', audience: 'For publishers and investors',
        intro: 'By submitting a partner profile on SRY Game Hub (the "Platform", operated by SRY Interactive, "we"), you agree to the terms below on behalf of your company or organisation.',
        clauses: [
          ['Your profile', 'You confirm that you represent the company or organisation named in your profile, that your profile and verification materials are accurate, and that you have the right to use the name and logo you provide.'],
          ['Use of your profile', 'We may display, translate, edit and reformat your public profile (name, logo, business type, region, introduction and links) on the Platform and in promotion of the Platform. Verification materials are seen only by our review team.'],
          ['Contact details', 'By providing a contact email and choosing to show it, you agree that developers with an approved game on the Platform may view it and contact you. If you choose to hide it, we collect developers\' interest and pass it on to you. We may also contact you about your account and about games that may suit you.'],
          ['Developer information', 'Developer contact details and project information you obtain through the Platform may be used only to discuss publishing, investment or similar cooperation with that developer. Do not resell it, pass it to unrelated third parties or use it for bulk marketing.'],
          ['The Platform\'s role', 'We provide information and introductions only. Game information is supplied by developers and we do not guarantee its accuracy. Discussions and deals are between you and the developer; we are not a party to them and are not responsible for their outcome.'],
          ['Review and suspension', 'Partner profiles are reviewed. We may decline, suspend or remove an account if information is inaccurate or these terms are not followed. You can ask us to update or delete your profile at ' + CONTACT + '.'],
          ['Changes', 'We may update this agreement and will post the new version on this page. You are asked to agree to the current version the next time you submit your profile.']
        ] },
      zh: { title: '合作方协议', audience: '面向发行商和投资者',
        intro: '在 SRY Game Hub（由 SRY Interactive 运营，下称“平台”或“我们”）提交合作方资料，即表示你代表所在公司或机构同意以下条款。',
        clauses: [
          ['你的资料', '你确认自己有权代表资料中的公司或机构；资料和认证材料真实准确，并有权使用所提交的名称和 Logo。'],
          ['资料的使用', '我们可以在平台及平台推广中展示、翻译、编辑和调整你的公开资料（名称、Logo、业务类型、地区、简介、链接）。认证材料仅审核团队可见。'],
          ['联系方式', '你填写联系邮箱并选择公开，即表示同意平台上已有游戏通过审核的开发者查看该邮箱并与你联系。如选择不公开，开发者的合作意向由我们汇总后转达给你。我们也可能就账号以及适合你的项目联系你。'],
          ['开发者信息', '你通过平台获得的开发者联系方式和项目信息，只能用于与该开发者洽谈发行、投资等合作，不得转售、提供给无关第三方或用于群发营销。'],
          ['平台角色', '我们只提供信息展示和对接。游戏信息由开发者提供，我们不保证其准确性。沟通与合作由你和开发者自行负责，我们不是其中一方，也不对结果承担责任。'],
          ['审核与停用', '合作方资料需经审核。如资料不实或违反本协议，我们可以拒绝、暂停或移除账号。你可以发邮件至 ' + CONTACT + '，要求修改或删除资料。'],
          ['协议更新', '我们可能更新本协议，并在本页公布新版本。下次提交资料时，需要同意当时的版本。']
        ] },
      ko: { title: '파트너 약관', audience: '퍼블리셔·투자자용',
        intro: 'SRY Game Hub(SRY Interactive가 운영하며, 이하 "플랫폼" 또는 "당사")에 파트너 프로필을 제출하면 소속 회사 또는 기관을 대표하여 아래 약관에 동의하는 것으로 봅니다.',
        clauses: [
          ['프로필', '귀하는 프로필에 기재한 회사 또는 기관을 대표할 권한이 있고, 프로필과 인증 자료가 정확하며, 제출한 명칭과 로고를 사용할 권리가 있음을 확인합니다.'],
          ['프로필의 이용', '당사는 공개 프로필(명칭, 로고, 사업 유형, 지역, 소개, 링크)을 플랫폼과 플랫폼 홍보에서 게시, 번역, 편집 및 형식 조정할 수 있습니다. 인증 자료는 심사팀만 확인합니다.'],
          ['연락처', '연락용 이메일을 입력하고 공개를 선택하면, 플랫폼에서 승인된 게임을 보유한 개발자가 이를 확인하고 귀하에게 연락하는 데 동의하는 것으로 봅니다. 비공개를 선택하면 개발자의 협업 의향을 당사가 모아 전달합니다. 당사도 계정 및 적합한 게임과 관련해 연락할 수 있습니다.'],
          ['개발자 정보', '플랫폼을 통해 얻은 개발자 연락처와 프로젝트 정보는 해당 개발자와 퍼블리싱·투자 등 협업을 논의하는 목적으로만 사용할 수 있으며, 재판매하거나 무관한 제3자에게 제공하거나 대량 마케팅에 사용할 수 없습니다.'],
          ['플랫폼의 역할', '당사는 정보 제공과 연결만 담당합니다. 게임 정보는 개발자가 제공한 것으로 당사는 그 정확성을 보증하지 않습니다. 협의와 계약은 귀하와 개발자 간의 일이며, 당사는 그 당사자가 아니고 결과에 책임을 지지 않습니다.'],
          ['심사 및 정지', '파트너 프로필은 심사를 거칩니다. 정보가 사실과 다르거나 본 약관을 위반한 경우 당사는 계정을 거절, 정지 또는 삭제할 수 있습니다. 프로필 수정이나 삭제는 ' + CONTACT + ' 으로 요청할 수 있습니다.'],
          ['약관 변경', '당사는 본 약관을 변경할 수 있으며 새 버전을 이 페이지에 게시합니다. 다음에 프로필을 제출할 때 당시 버전에 동의해야 합니다.']
        ] }
    }
  };

  // Text around the linked agreement title in the consent checkbox label.
  const consent = {
    en: ['I have read and agree to the ', '.'],
    zh: ['我已阅读并同意《', '》'],
    ko: ['', '을 읽었으며 이에 동의합니다.']
  };
  const errorText = {
    en: { terms_required: title => 'Please read and agree to the ' + title + ' before submitting.', terms_outdated: () => 'The agreement has been updated. Please refresh the page and agree to the current version.' },
    zh: { terms_required: title => '提交前请阅读并勾选同意《' + title + '》。', terms_outdated: () => '协议已更新，请刷新页面后重新阅读并同意。' },
    ko: { terms_required: title => '제출 전에 ' + title + '을 읽고 동의해 주세요.', terms_outdated: () => '약관이 변경되었습니다. 페이지를 새로고침한 뒤 현재 버전에 동의해 주세요.' }
  };

  const pick = (table, lang) => table[lang] || table.en;
  const element = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
  };

  // Fills a checkbox label's text container: "I have read and agree to the <link>."
  function renderConsent(target, doc, lang) {
    const [before, after] = pick(consent, lang);
    const link = element('a', pick(agreements[doc], lang).title);
    link.href = '/terms.html#' + doc; link.target = '_blank'; link.rel = 'noopener';
    target.replaceChildren(before, link, after);
  }

  // Fills a container with the short guideline list; `more` appends a link to the full agreement.
  function renderGuidelines(target, lang, more) {
    const text = pick(guidelines, lang), list = element('ul');
    list.append(...text.items.map(item => element('li', item)));
    target.replaceChildren(element('strong', text.title), list);
    if (more) {
      const link = element('a', pick(agreements.developer, lang).title + ' →');
      link.href = '/terms.html#developer'; link.target = '_blank'; link.rel = 'noopener';
      target.append(link);
    }
  }

  const errors = (doc, lang) => {
    const title = pick(agreements[doc], lang).title, text = pick(errorText, lang);
    return { terms_required: text.terms_required(title), terms_outdated: text.terms_outdated() };
  };

  root.SryTerms = { version, guidelines, agreements, renderConsent, renderGuidelines, errors };
})(globalThis);
