#!/bin/bash -xe

export CURRENT_NODE_IP=$(curl http://169.254.169.254/latest/meta-data/public-ipv4)
export INSTANCE_ID=$(curl http://169.254.169.254/latest/meta-data/instance-id)

if [ $CURRENT_NODE_IP != $NODE_IP ]; then
    aws ec2 associate-address --region $REGION --instance-id $INSTANCE_ID --allocation-id $EIP
fi

$(aws ecr get-login --no-include-email --region $REGION)
pip install docker-compose

export STRELETS_VERSION=baebf901a1a1fff7f06b01d0b6e39a02d2e68445
curl -q https://s3.amazonaws.com/orbs-network-releases/infrastructure/strelets/strelets-${STRELETS_VERSION}.bin -o /usr/local/bin/strelets && chmod +x /usr/local/bin/strelets

export ENV_FILE=/opt/orbs/.env

echo NODE_IP=$NODE_IP >> $ENV_FILE
echo NODE_NAME=$NODE_NAME >> $ENV_FILE
echo NODE_ENV=$NODE_ENV >> $ENV_FILE
echo INSTANCE_ID=$INSTANCE_ID >> $ENV_FILE
echo ETHEREUM_NODE_HTTP_ADDRESS=$ETHEREUM_NODE_HTTP_ADDRESS >> $ENV_FILE

export DOCKER_TAG=${DOCKER_TAG-master}
# TODO: remove default image
export DOCKER_IMAGE=${DOCKER_IMAGE-506367651493.dkr.ecr.us-west-2.amazonaws.com/orbs-network}

crontab /opt/orbs/crontab

/usr/local/bin/docker-compose -f /opt/orbs/docker-compose.yml up -d

docker pull $DOCKER_IMAGE:$DOCKER_TAG

cd /opt/orbs && \
/usr/local/bin/strelets provision-virtual-chain \
    --keys-config keys.json \
    --chain-config chain.json \
    --peers-config network.json
