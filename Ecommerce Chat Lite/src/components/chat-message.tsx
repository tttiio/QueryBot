"use client"

import React, {useEffect, useRef, useState} from 'react';
import SidebarTrigger from "@/components/sidebar-trigger";
import {Flex, message as apiMessage} from "antd";
import {Bubble, Sender, useXAgent, useXChat} from "@ant-design/x";
import OpenAI from "openai";
import {DeepSeekIcon} from "@/components/Icons";
import MarkdownRender from "@/components/markdown-render";
import {BubbleDataType} from "@ant-design/x/es/bubble/BubbleList";
import InitWelcome from "@/components/init-welcome";
import {useChat} from "@/provider/chat-provider";
import BubbleActions from "@/components/bubble-actions";
import BubbleThinking from "@/components/bubble-thinking";
import SenderActions, {ActionsComponents} from "@/components/sender-actions";


/**
 * DeepSeek大模型配置
 */
// 1. --- 修改这里：直接指定模型名称 ---
const MODEL_CHAT = 'deepseek-chat'
const MODEL_REASONER = 'deepseek-reasoner'
// ------------------------------------

// 2. --- 修改这里：填入你的中转站地址和Key ---
const client = new OpenAI({
    baseURL: 'https://api.rcouyi.com/v1', // 你的中转站地址 (注意要加 /v1)
    apiKey: 'sk-raICAeNJSasX7agBD89cF84cA73c462191F0991662281aD0', // 你的中转站 Key
    dangerouslyAllowBrowser: true,
});
// -----------------------------------------

export type AgentMessage = {
    content?: string;
    reasoningContent?: string;
};

type InputType = {
    message: AgentMessage,
    messages: AgentMessage[]
}

type MessageType = {
    content?: string;
    reasoningContent?: string;
};

type OutputType = {
    content?: string;
    reasoningContent?: string;
};


interface ChatMessageProps {
    handleAddConversation: (msg: string) => void;
}

const ChatMessage = (
    {handleAddConversation}: ChatMessageProps
) => {

    const {activeKey, openReasoner, openSearch, setOpenReasoner, setOpenSearch} = useChat();
    const [inputTxt, setInputTxt] = useState<string>('')
    const [requestLoading, setRequestLoading] = useState<boolean>(false)
    const [model, setModel] = useState<string>(MODEL_CHAT)
    const modelRef = useRef(model);
    const abortControllerRef = useRef<AbortController>(null);


    /**
     * 与大模型交互
     */
    const [agent] = useXAgent<AgentMessage, InputType, AgentMessage>({
        request: async (info, callbacks) => {
            const {message, messages} = info
            const {onUpdate, onSuccess, onError} = callbacks
            console.log('message: ', message)
            console.log('message list: ', messages)
            console.log('model: ', modelRef.current) // 这将是 MODEL_CHAT (默认) 或 MODEL_REASONER (深度思考)

            setRequestLoading(true); // 在开始时设置 loading

            const aiMessage: AgentMessage = {
                content: '',
                reasoningContent: '',
            }

            try {
                // --- (这是你要求的新逻辑) ---
                // 检查是否 *点击了* "深度思考"
                if (modelRef.current === MODEL_REASONER) {

                    // --- (B) 深度思考模式: 使用之前的大模型 (中转站) ---
                    console.log('深度思考模式: 调用中转站 AI API...');
                    aiMessage.reasoningContent = '大模型思考中...';
                    onUpdate(aiMessage);

                    const streamCompletions = await client.chat.completions.create({
                            model: modelRef.current, // 这将是 MODEL_REASONER
                            messages: [{role: 'user', content: message?.content || ''}],
                            stream: true
                        },
                        {
                            signal: abortControllerRef.current?.signal,
                        });

                    let firstChunk = true;
                    for await (let chunk of streamCompletions) {
                        if (firstChunk) {
                            setRequestLoading(false); // 在收到第一个数据块时停止 loading
                            firstChunk = false;
                        }

                        const reasoning_content: string = (chunk.choices[0]?.delta as any)?.reasoning_content || (chunk.choices[0]?.delta as any)?.reasoning
                        const resp_content: any = chunk.choices[0]?.delta?.content
                        if (reasoning_content) {
                            aiMessage.reasoningContent += reasoning_content;
                        }
                        if (resp_content) {
                            aiMessage.content += resp_content;
                        }
                        onUpdate(aiMessage)
                    }
                    onSuccess([aiMessage]);

                } else {

                    // --- (A) 默认模式: 使用你的 Python SQL Agent ---
                    console.log('默认模式: 调用本地 SQL Agent API...');
                    aiMessage.reasoningContent = '正在连接本地 SQL 数据库...';
                    onUpdate(aiMessage); // 先显示"思考中"

                    const response = await fetch('http://localhost:8000/query-sql', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({ query: message?.content || '' }),
                        signal: abortControllerRef.current?.signal,
                    });

                    if (!response.ok) {
                        const errData = await response.json();
                        throw new Error(errData.error || 'API 请求失败');
                    }

                    const data = await response.json();

                    if (data.error) {
                         throw new Error(data.error);
                    }

                    // 成功获取到 Python 脚本的返回结果
                    aiMessage.content = data.result;
                    aiMessage.reasoningContent = 'QueryBot执行完毕。';
                    onSuccess([aiMessage]); // 一次性更新最终结果
                }

            } catch (e: any) {
                console.log('error', e);
                // (重要) 把后端的错误信息显示给用户
                aiMessage.content = `发生错误: ${e.message}`;
                onError(e as Error);
            } finally {
                setRequestLoading(false); // 确保在最后总是停止 loading
            }
        }
    });

    const {onRequest, messages, setMessages} = useXChat<AgentMessage, AgentMessage, InputType, AgentMessage>({
        agent: agent,
        requestPlaceholder: {
            content: '请求中...'
        },
    });

    useEffect(() => {
        const newModel = openReasoner ? MODEL_REASONER : MODEL_CHAT;
        setModel(newModel)
        modelRef.current = newModel
        console.log('set model:', newModel)
    }, [openReasoner]);

    useEffect(() => {
        modelRef.current = model;
    }, [model]);

    useEffect(() => {
        if (!activeKey) {
            setMessages([])
        }
    }, [activeKey])

    const messageItems = messages.map((
        {id, message, status}) =>
        ({
            key: id,
            content: message.content || '',
            role: status === 'local' ? 'user' : 'ai',
            loading: status === 'loading' && requestLoading,
            header: (status !== 'local' && <BubbleThinking content={message.reasoningContent || ''}/>),
            footer: ((!agent.isRequesting() && status !== 'local') &&
                <BubbleActions content={message.content || ''}/>
            ),
            placement: status !== 'local' ? 'start' : 'end',
            variant: status !== 'local' ? (message.content ? 'outlined' : 'borderless') : undefined,
            // avatar: status !== 'local' ?
            //     {
            //         icon: <DeepSeekIcon/>,
            //         style: {border: '1px solid #c5eaee', backgroundColor: 'white'}
            //     } : undefined,
            avatar: status !== 'local' ?
                {
                    src: '/logo.jpg' // 替换 icon 和 style
                } : undefined,
            typing: status !== 'local' && (status === 'loading' && requestLoading) ?
                {step: 5, interval: 50} : undefined,
            style: status !== 'local' ? {maxWidth: 700} : undefined,
            messageRender: status !== 'local' ?
                ((content: any) => (<MarkdownRender content={content}/>)) : undefined,
        }));

    // 发送消息
    const handleSubmit = (msg: string) => {
        onRequest({content: msg});
        setInputTxt('');
        setRequestLoading(true);
        if (!activeKey) {
            handleAddConversation(msg);
        }
    }

    // @ts-ignore
    const finalMessageItems: BubbleDataType[] = messageItems.length > 0 ? messageItems
        : [{
            content: (<InitWelcome handleSubmit={handleSubmit}/>),
            variant: 'borderless'
        }];


    // 停止
    const handleCancel = () => {
        setRequestLoading(false);
        abortControllerRef.current?.abort('停止');
        apiMessage.error('已停止')
    }

    // 通过 useEffect 清理函数自动取消未完成的请求：
    useEffect(() => {
        abortControllerRef.current = new AbortController();
        return () => {
            abortControllerRef.current?.abort('停止');
        }
    }, []);

    return (<>

        <div className='fixed z-10 h-12 w-12'>
            <SidebarTrigger/>
        </div>

        <Flex
            vertical
            gap={'large'}
            className='w-full'
            style={{margin: '0px auto', height: '94.5vh'}}
        >
            {/* 消息列表 */}
            <div className='h-full w-full px-1 overflow-y-auto scrollbar-container'>
                <Bubble.List
                    className='max-w-2xl  mx-auto'
                    //roles={roles}
                    items={finalMessageItems}
                />
            </div>

            {/* 输入框 */}
            <Sender
                className='max-w-2xl mx-auto'
                style={{marginTop: 'auto', borderRadius: '20px'}}
                autoSize={{minRows: 2, maxRows: 8}}
                placeholder='请输入你的问题...'
                loading={agent.isRequesting()}
                value={inputTxt}
                onChange={setInputTxt}
                onSubmit={handleSubmit}
                onCancel={handleCancel}
                actions={false}
                footer={(info: { components: ActionsComponents }) =>
                    <SenderActions
                        components={info.components}
                        inputTxt={inputTxt}
                        loading={agent.isRequesting()}
                    />
                }
            />
        </Flex>
    </>);
};

export default ChatMessage;


