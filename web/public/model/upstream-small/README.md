---
tags:
- image-classification
- timm
- transformers
library_name: timm
license: apache-2.0
datasets:
- imagenet-1k
---
# Model card for mobilenetv4_conv_small.e2400_r224_in1k

A MobileNet-V4 image classification model. Trained on ImageNet-1k by Ross Wightman.

Trained with `timm` scripts using hyper-parameters inspired by the MobileNet-V4 paper with `timm` enhancements.

NOTE: So far, these are the only known MNV4 weights. Official weights for Tensorflow models are unreleased.


## Model Details
- **Model Type:** Image classification / feature backbone
- **Model Stats:**
  - Params (M): 3.8
  - GMACs: 0.2
  - Activations (M): 2.0
  - Image size: train = 224 x 224, test = 256 x 256
- **Dataset:** ImageNet-1k
- **Original:** https://github.com/tensorflow/models/tree/master/official/vision
- **Papers:**
  - MobileNetV4 -- Universal Models for the Mobile Ecosystem: https://arxiv.org/abs/2404.10518
  - PyTorch Image Models: https://github.com/huggingface/pytorch-image-models

## Model Usage
### Image Classification
```python
from urllib.request import urlopen
from PIL import Image
import timm

img = Image.open(urlopen(
    'https://huggingface.co/datasets/huggingface/documentation-images/resolve/main/beignets-task-guide.png'
))

model = timm.create_model('mobilenetv4_conv_small.e2400_r224_in1k', pretrained=True)
model = model.eval()

# get model specific transforms (normalization, resize)
data_config = timm.data.resolve_model_data_config(model)
transforms = timm.data.create_transform(**data_config, is_training=False)

output = model(transforms(img).unsqueeze(0))  # unsqueeze single image into batch of 1

top5_probabilities, top5_class_indices = torch.topk(output.softmax(dim=1) * 100, k=5)
```

### Feature Map Extraction
```python
from urllib.request import urlopen
from PIL import Image
import timm

img = Image.open(urlopen(
    'https://huggingface.co/datasets/huggingface/documentation-images/resolve/main/beignets-task-guide.png'
))

model = timm.create_model(
    'mobilenetv4_conv_small.e2400_r224_in1k',
    pretrained=True,
    features_only=True,
)
model = model.eval()

# get model specific transforms (normalization, resize)
data_config = timm.data.resolve_model_data_config(model)
transforms = timm.data.create_transform(**data_config, is_training=False)

output = model(transforms(img).unsqueeze(0))  # unsqueeze single image into batch of 1

for o in output:
    # print shape of each feature map in output
    # e.g.:
    #  torch.Size([1, 32, 112, 112])
    #  torch.Size([1, 32, 56, 56])
    #  torch.Size([1, 64, 28, 28])
    #  torch.Size([1, 96, 14, 14])
    #  torch.Size([1, 960, 7, 7])

    print(o.shape)
```

### Image Embeddings
```python
from urllib.request import urlopen
from PIL import Image
import timm

img = Image.open(urlopen(
    'https://huggingface.co/datasets/huggingface/documentation-images/resolve/main/beignets-task-guide.png'
))

model = timm.create_model(
    'mobilenetv4_conv_small.e2400_r224_in1k',
    pretrained=True,
    num_classes=0,  # remove classifier nn.Linear
)
model = model.eval()

# get model specific transforms (normalization, resize)
data_config = timm.data.resolve_model_data_config(model)
transforms = timm.data.create_transform(**data_config, is_training=False)

output = model(transforms(img).unsqueeze(0))  # output is (batch_size, num_features) shaped tensor

# or equivalently (without needing to set num_classes=0)

output = model.forward_features(transforms(img).unsqueeze(0))
# output is unpooled, a (1, 960, 7, 7) shaped tensor

output = model.forward_head(output, pre_logits=True)
# output is a (1, num_features) shaped tensor
```

## Model Comparison
### By Top-1

| model                                                                                                                    | top1   | top5   | param_count | img_size |
|--------------------------------------------------------------------------------------------------------------------------|--------|--------|-------------|----------|
| [mobilenetv4_conv_aa_large.e230_r448_in12k_ft_in1k](http://hf.co/timm/mobilenetv4_conv_aa_large.e230_r448_in12k_ft_in1k) | 84.99  | 97.294 | 32.59       | 544      |
| [mobilenetv4_conv_aa_large.e230_r384_in12k_ft_in1k](http://hf.co/timm/mobilenetv4_conv_aa_large.e230_r384_in12k_ft_in1k) | 84.772 | 97.344 | 32.59       | 480      |
| [mobilenetv4_conv_aa_large.e230_r448_in12k_ft_in1k](http://hf.co/timm/mobilenetv4_conv_aa_large.e230_r448_in12k_ft_in1k) | 84.64  | 97.114 | 32.59       | 448      |
| [mobilenetv4_hybrid_large.ix_e600_r384_in1k](http://hf.co/timm/mobilenetv4_hybrid_large.ix_e600_r384_in1k)               | 84.356 | 96.892 | 37.76       | 448      |
| [mobilenetv4_conv_aa_large.e230_r384_in12k_ft_in1k](http://hf.co/timm/mobilenetv4_conv_aa_large.e230_r384_in12k_ft_in1k) | 84.314 | 97.102 | 32.59       | 384      |
| [mobilenetv4_hybrid_large.e600_r384_in1k](http://hf.co/timm/mobilenetv4_hybrid_large.e600_r384_in1k)                     | 84.266 | 96.936 | 37.76       | 448      |
| [mobilenetv4_hybrid_large.ix_e600_r384_in1k](http://hf.co/timm/mobilenetv4_hybrid_large.ix_e600_r384_in1k)               | 83.990 | 96.702 | 37.76       | 384      |
| [mobilenetv4_conv_aa_large.e600_r384_in1k](http://hf.co/timm/mobilenetv4_conv_aa_large.e600_r384_in1k)                   | 83.824 | 96.734 | 32.59       | 480      |
| [mobilenetv4_hybrid_large.e600_r384_in1k](http://hf.co/timm/mobilenetv4_hybrid_large.e600_r384_in1k)                     | 83.800 | 96.770 | 37.76       | 384      |
| [mobilenetv4_hybrid_medium.ix_e550_r384_in1k](http://hf.co/timm/mobilenetv4_hybrid_medium.ix_e550_r384_in1k)             | 83.394 | 96.760 | 11.07       | 448      |
| [mobilenetv4_conv_large.e600_r384_in1k](http://hf.co/timm/mobilenetv4_conv_large.e600_r384_in1k)                         | 83.392 | 96.622 | 32.59       | 448      |
| [mobilenetv4_conv_aa_large.e600_r384_in1k](http://hf.co/timm/mobilenetv4_conv_aa_large.e600_r384_in1k)                   | 83.244 | 96.392 | 32.59       | 384      |
| [mobilenetv4_hybrid_medium.e200_r256_in12k_ft_in1k](http://hf.co/timm/mobilenetv4_hybrid_medium.e200_r256_in12k_ft_in1k) | 82.99  | 96.67  | 11.07       | 320      |
| [mobilenetv4_hybrid_medium.ix_e550_r384_in1k](http://hf.co/timm/mobilenetv4_hybrid_medium.ix_e550_r384_in1k)             | 82.968 | 96.474 | 11.07       | 384      |
| [mobilenetv4_conv_large.e600_r384_in1k](http://hf.co/timm/mobilenetv4_conv_large.e600_r384_in1k)                         | 82.952 | 96.266 | 32.59       | 384      |
| [mobilenetv4_conv_large.e500_r256_in1k](http://hf.co/timm/mobilenetv4_conv_large.e500_r256_in1k)                         | 82.674 | 96.31  | 32.59       | 320      |
| [mobilenetv4_hybrid_medium.ix_e550_r256_in1k](http://hf.co/timm/mobilenetv4_hybrid_medium.ix_e550_r256_in1k)             | 82.492 | 96.278 | 11.07       | 320      |
| [mobilenetv4_hybrid_medium.e200_r256_in12k_ft_in1k](http://hf.co/timm/mobilenetv4_hybrid_medium.e200_r256_in12k_ft_in1k) | 82.364 | 96.256 | 11.07       | 256      |
| [mobilenetv4_conv_large.e500_r256_in1k](http://hf.co/timm/mobilenetv4_conv_large.e500_r256_in1k)                         | 81.862 | 95.69  | 32.59       | 256      |
| [resnet50d.ra4_e3600_r224_in1k](http://hf.co/timm/resnet50d.ra4_e3600_r224_in1k)                                         | 81.838 | 95.922 | 25.58       | 288      |    
| [mobilenetv3_large_150d.ra4_e3600_r256_in1k](http://hf.co/timm/mobilenetv3_large_150d.ra4_e3600_r256_in1k)               | 81.806 | 95.9   | 14.62       | 320      |
| [mobilenetv4_hybrid_medium.ix_e550_r256_in1k](http://hf.co/timm/mobilenetv4_hybrid_medium.ix_e550_r256_in1k)             | 81.446 | 95.704 | 11.07       | 256      |
| [efficientnet_b1.ra4_e3600_r240_in1k](http://hf.co/timm/efficientnet_b1.ra4_e3600_r240_in1k)                             | 81.440 | 95.700 | 7.79        | 288      |
| [mobilenetv4_hybrid_medium.e500_r224_in1k](http://hf.co/timm/mobilenetv4_hybrid_medium.e500_r224_in1k)                   | 81.276 | 95.742 | 11.07       | 256      |
| [resnet50d.ra4_e3600_r224_in1k](http://hf.co/timm/resnet50d.ra4_e3600_r224_in1k)                                         | 80.952 | 95.384 | 25.58       | 224      |
| [mobilenetv3_large_150d.ra4_e3600_r256_in1k](http://hf.co/timm/mobilenetv3_large_150d.ra4_e3600_r256_in1k)               | 80.944 | 95.448 | 14.62       | 256      |
| [mobilenetv4_conv_medium.e500_r256_in1k](http://hf.co/timm/mobilenetv4_conv_medium.e500_r256_in1k)                       | 80.858 | 95.768 | 9.72        | 320      |
| [mobilenet_edgetpu_v2_m.ra4_e3600_r224_in1k](http://hf.co/timm/mobilenet_edgetpu_v2_m.ra4_e3600_r224_in1k)               | 80.680 | 95.442 | 8.46        | 256      |
| [mobilenetv4_hybrid_medium.e500_r224_in1k](http://hf.co/timm/mobilenetv4_hybrid_medium.e500_r224_in1k)                   | 80.442 | 95.38  | 11.07       | 224      |
| [efficientnet_b1.ra4_e3600_r240_in1k](http://hf.co/timm/efficientnet_b1.ra4_e3600_r240_in1k)                             | 80.406 | 95.152 | 7.79        | 240      |
| [mobilenetv4_conv_blur_medium.e500_r224_in1k](http://hf.co/timm/mobilenetv4_conv_blur_medium.e500_r224_in1k)             | 80.142 | 95.298 | 9.72        | 256      |
| [mobilenet_edgetpu_v2_m.ra4_e3600_r224_in1k](http://hf.co/timm/mobilenet_edgetpu_v2_m.ra4_e3600_r224_in1k)               | 80.130 | 95.002 | 8.46        | 224      |
| [mobilenetv4_conv_medium.e500_r256_in1k](http://hf.co/timm/mobilenetv4_conv_medium.e500_r256_in1k)                       | 79.928 | 95.184 | 9.72        | 256      |
| [mobilenetv4_conv_medium.e500_r224_in1k](http://hf.co/timm/mobilenetv4_conv_medium.e500_r224_in1k)                       | 79.808 | 95.186 | 9.72        | 256      |
| [mobilenetv4_conv_blur_medium.e500_r224_in1k](http://hf.co/timm/mobilenetv4_conv_blur_medium.e500_r224_in1k)             | 79.438 | 94.932 | 9.72        | 224      |
| [efficientnet_b0.ra4_e3600_r224_in1k](http://hf.co/timm/efficientnet_b0.ra4_e3600_r224_in1k)                             | 79.364 | 94.754 | 5.29        | 256      |
| [mobilenetv4_conv_medium.e500_r224_in1k](http://hf.co/timm/mobilenetv4_conv_medium.e500_r224_in1k)                       | 79.094 | 94.77  | 9.72        | 224      |
| [efficientnet_b0.ra4_e3600_r224_in1k](http://hf.co/timm/efficientnet_b0.ra4_e3600_r224_in1k)                             | 78.584 | 94.338 | 5.29        | 224      |
| [mobilenetv1_125.ra4_e3600_r224_in1k](http://hf.co/timm/mobilenetv1_125.ra4_e3600_r224_in1k)                             | 77.600 | 93.804 | 6.27        | 256      |
| [mobilenetv3_large_100.ra4_e3600_r224_in1k](http://hf.co/timm/mobilenetv3_large_100.ra4_e3600_r224_in1k)                 | 77.164 | 93.336 | 5.48        | 256      |
| [mobilenetv1_125.ra4_e3600_r224_in1k](http://hf.co/timm/mobilenetv1_125.ra4_e3600_r224_in1k)                             | 76.924 | 93.234 | 6.27        | 224      |
| [mobilenetv1_100h.ra4_e3600_r224_in1k](http://hf.co/timm/mobilenetv1_100h.ra4_e3600_r224_in1k)                           | 76.596 | 93.272 | 5.28        | 256      |
| [mobilenetv3_large_100.ra4_e3600_r224_in1k](http://hf.co/timm/mobilenetv3_large_100.ra4_e3600_r224_in1k)                 | 76.310 | 92.846 | 5.48        | 224      |
| [mobilenetv1_100.ra4_e3600_r224_in1k](http://hf.co/timm/mobilenetv1_100.ra4_e3600_r224_in1k)                             | 76.094 | 93.004 | 4.23        | 256      |
| [mobilenetv1_100h.ra4_e3600_r224_in1k](http://hf.co/timm/mobilenetv1_100h.ra4_e3600_r224_in1k)                           | 75.662 | 92.504 | 5.28        | 224      |
| [mobilenetv1_100.ra4_e3600_r224_in1k](http://hf.co/timm/mobilenetv1_100.ra4_e3600_r224_in1k)                             | 75.382 | 92.312 | 4.23        | 224      |
| [mobilenetv4_conv_small.e2400_r224_in1k](http://hf.co/timm/mobilenetv4_conv_small.e2400_r224_in1k)                       | 74.616 | 92.072 | 3.77        | 256      |
| [mobilenetv4_conv_small.e1200_r224_in1k](http://hf.co/timm/mobilenetv4_conv_small.e1200_r224_in1k)                       | 74.292 | 92.116 | 3.77        | 256      |
| [mobilenetv4_conv_small.e2400_r224_in1k](http://hf.co/timm/mobilenetv4_conv_small.e2400_r224_in1k)                       | 73.756 | 91.422 | 3.77        | 224      |
| [mobilenetv4_conv_small.e1200_r224_in1k](http://hf.co/timm/mobilenetv4_conv_small.e1200_r224_in1k)                       | 73.454 | 91.34  | 3.77        | 224      |

## Citation
```bibtex
@article{qin2024mobilenetv4,
  title={MobileNetV4-Universal Models for the Mobile Ecosystem},
  author={Qin, Danfeng and Leichner, Chas and Delakis, Manolis and Fornoni, Marco and Luo, Shixin and Yang, Fan and Wang, Weijun and Banbury, Colby and Ye, Chengxi and Akin, Berkin and others},
  journal={arXiv preprint arXiv:2404.10518},
  year={2024}
}
```
```bibtex
@misc{rw2019timm,
  author = {Ross Wightman},
  title = {PyTorch Image Models},
  year = {2019},
  publisher = {GitHub},
  journal = {GitHub repository},
  doi = {10.5281/zenodo.4414861},
  howpublished = {\url{https://github.com/huggingface/pytorch-image-models}}
}
```
